import http from "node:http";
import type { HealthResponse } from "../shared/api.js";
import type { CallResponse, CallsResponse, ClearResponse, GatewaySettingsRequest, GatewayState, GatewayStatus, RevealResponse } from "../shared/calls.js";
import { CallStore } from "./calls/store.js";
import type { FindResponse } from "../shared/find.js";
import type { ServiceResponse, ServicesResponse, ShapesResponse } from "../shared/models.js";
import type { Config } from "./config.js";
import { checkFetchSite, checkRequest } from "./guard.js";
import { find } from "./find.js";
import { modelIndex } from "./model-index/index.js";
import type { Monitor } from "./monitor.js";
import { handleSend } from "./sender/route.js";
import { readStatic } from "./static.js";

export const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
};

/** What the API needs of the Gateway: the Calls it recorded, whether it is listening, and its certificate. */
export type CallsContext = { store: CallStore; gateway: () => { state: GatewayState; certificate: string } };

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `type` set means `body` is a string sent as is, with that content type; otherwise `body` is sent as JSON. */
type Reply = { status: number; type?: string; body: unknown; headers?: Record<string, string> };
type Handler = (ctx: { config: Config; monitor: Monitor; calls: CallsContext; url: URL; req: http.IncomingMessage }) => Promise<Reply> | Reply;

/** One entry per API path; each declares the methods it answers. Later tickets add routes here. */
type Route = { path: string; methods: Partial<Record<Method, Handler>> };

const routes: Route[] = [
  {
    path: "/api/health",
    methods: {
      // The monitor's latest result. Reading it has no side effects, and health checks are not AWS calls.
      GET: async ({ monitor }): Promise<Reply> => ({
        status: 200,
        body: { emulator: await monitor.current() } satisfies HealthResponse,
      }),
    },
  },
  {
    path: "/api/health/check",
    methods: {
      // "Try again": checks now. A POST, since it makes the Console ask the Emulator.
      POST: async ({ monitor }): Promise<Reply> => ({
        status: 200,
        body: { emulator: await monitor.checkNow() } satisfies HealthResponse,
      }),
    },
  },
  {
    path: "/api/services",
    methods: {
      // Every service the Emulator offers, with its operation counts and implementation labels.
      GET: async ({ config }): Promise<Reply> => {
        const index = await modelIndex(config.modelIndexDir);
        return { status: 200, headers: modelHeaders(index), body: { meta: index.meta, services: index.services() } satisfies ServicesResponse };
      },
    },
  },
  {
    path: "/api/find",
    methods: {
      // Find: services and operations by name, capped. A GET that only reads the generated index (no Emulator call).
      // No ETag: the answer depends on `q`, and it is cheap to compute.
      GET: async ({ config, url }): Promise<Reply> => {
        const index = await modelIndex(config.modelIndexDir);
        return { status: 200, body: (await find(index, url.searchParams.get("q") ?? "")) satisfies FindResponse };
      },
    },
  },
  {
    path: "/api/service",
    methods: {
      // One service's operations. The service is a query parameter, `sdkId` or `slug`: some SDK IDs contain spaces.
      GET: async ({ config, url }): Promise<Reply> => {
        const key = serviceKey(url);
        if (!key) return { status: 400, body: { error: "sdkId or slug is required" } };
        const index = await modelIndex(config.modelIndexDir);
        const detail = await index.detail(key);
        const service = index.service(key);
        if (!service || !detail) return { status: 404, body: { error: "Unknown service" } };
        return {
          status: 200,
          headers: modelHeaders(index),
          body: {
            emulator: index.meta.emulator,
            service,
            operations: detail.operations,
            commonErrors: detail.commonErrors,
            emulatorOnly: detail.emulatorOnly,
          } satisfies ServiceResponse,
        };
      },
    },
  },
  {
    path: "/api/service/shapes",
    methods: {
      // A service's Smithy shape graph, or with `operation=Name` only the shapes reachable from that operation.
      GET: async ({ config, url }): Promise<Reply> => {
        const key = serviceKey(url);
        if (!key) return { status: 400, body: { error: "sdkId or slug is required" } };
        const index = await modelIndex(config.modelIndexDir);
        const detail = await index.detail(key);
        if (!detail) return { status: 404, body: { error: "Unknown service" } };
        const operation = url.searchParams.get("operation");
        const shapes = operation === null ? detail.shapes : await index.operationShapes(key, operation);
        if (!shapes) return { status: 404, body: { error: "Unknown operation" } };
        return {
          status: 200,
          headers: modelHeaders(index),
          body: {
            sdkId: detail.sdkId,
            serviceShapeId: detail.serviceShapeId,
            commonErrors: detail.commonErrors,
            shapes,
          } satisfies ShapesResponse,
        };
      },
    },
  },
  {
    path: "/api/send",
    methods: {
      // Sends one operation to the Emulator, signed with the run's keys (which never leave the server).
      POST: ({ config, req }) => handleSend(config, req),
    },
  },
  {
    path: "/api/gateway",
    methods: {
      // The Gateway's state, the setting, counts and the first Call. A read changes nothing.
      GET: ({ config, calls }): Reply => ({ status: 200, body: gatewayStatus(config, calls) }),
    },
  },
  {
    path: "/api/gateway/settings",
    methods: {
      // "Record headers and status only". Applies to Calls recorded after the change.
      POST: async ({ config, calls, req }): Promise<Reply> => {
        const body = await readJson<Partial<GatewaySettingsRequest>>(req);
        if (typeof body?.headersOnly !== "boolean") return { status: 400, body: { error: "headersOnly must be true or false" } };
        calls.store.headersOnly = body.headersOnly;
        return { status: 200, body: gatewayStatus(config, calls) };
      },
    },
  },
  {
    path: "/api/gateway/certificate",
    methods: {
      // The public certificate an SDK must trust to follow an https URL back to the Gateway (B4). No key is in it.
      GET: ({ calls }): Reply => ({
        status: 200,
        type: "application/x-pem-file",
        body: calls.gateway().certificate,
        headers: { "content-disposition": 'attachment; filename="emulator-console-gateway.pem"' },
      }),
    },
  },
  {
    path: "/api/calls",
    methods: {
      // Calls newest first, without headers or bodies. `before` and `after` are Call ids; `run` an Emulator Run.
      GET: ({ calls, url }): Reply => {
        const num = (name: string) => {
          const v = url.searchParams.get(name);
          return v === null || v === "" ? undefined : Number(v);
        };
        const [limit, before, after, run] = ["limit", "before", "after", "run"].map(num);
        if ([limit, before, after, run].some((v) => v !== undefined && !Number.isFinite(v))) return { status: 400, body: { error: "limit, before, after and run must be numbers" } };
        return { status: 200, body: calls.store.list({ limit, before, after, run }) satisfies CallsResponse };
      },
    },
  },
  {
    path: "/api/calls/get",
    methods: {
      // One Call with its headers and bodies, hidden values still hidden.
      GET: ({ calls, url }): Reply => {
        const call = calls.store.get(Number(url.searchParams.get("id")));
        return call ? { status: 200, body: { call } satisfies CallResponse } : { status: 404, body: { error: "No such Call" } };
      },
    },
  },
  {
    path: "/api/calls/reveal",
    methods: {
      // The only route that sends hidden values: a POST, so it takes the stricter rule, and it names one Call.
      POST: async ({ calls, req }): Promise<Reply> => {
        const body = await readJson<{ id?: unknown }>(req);
        const call = typeof body?.id === "number" ? calls.store.reveal(body.id) : undefined;
        return call ? { status: 200, body: { call } satisfies RevealResponse } : { status: 404, body: { error: "No such Call" } };
      },
    },
  },
  {
    path: "/api/calls/clear",
    methods: {
      POST: ({ calls }): Reply => ({ status: 200, body: { cleared: calls.store.clear() } satisfies ClearResponse }),
    },
  },
];

function gatewayStatus(config: Config, calls: CallsContext): GatewayStatus {
  const { store } = calls;
  const first = store.firstOfRun;
  return {
    state: calls.gateway().state,
    port: config.gatewayPort,
    endpoint: `http://127.0.0.1:${config.gatewayPort}`,
    headersOnly: store.headersOnly,
    total: store.total,
    lastId: store.lastId,
    firstCall: first ? { id: first.id, operation: first.operation, method: first.method, path: first.path, startedAt: first.startedAt } : null,
    refusedFromBrowser: store.browserRefusals,
    tlsRefused: store.tlsRefusals,
    certificatePath: "/api/gateway/certificate",
  };
}

const MAX_JSON_BYTES = 4096;

/** Reads a small JSON body, or returns undefined when it is missing, too large or not JSON. */
async function readJson<T>(req: http.IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof value === "object" && value !== null ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The service a request names: `sdkId` or `slug`, never both empty. Lookups go through a Map, so any string is safe. */
function serviceKey(url: URL): string | null {
  return url.searchParams.get("sdkId") || url.searchParams.get("slug") || null;
}

/** The model routes answer from a generated artifact that changes only with a new build: validate, don't re-send. */
function modelHeaders(index: { version: string }): Record<string, string> {
  return { etag: `"${index.version}"`, "cache-control": "private, no-cache" };
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer, head = false, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extra, "content-type": type });
  res.end(head ? undefined : body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown, head = false, extra: Record<string, string> = {}) {
  send(res, status, "application/json", JSON.stringify(value), head, extra);
}

/** The caller creates and starts `monitor` and the Gateway (main.ts does); tests pass their own. */
export function createApp(
  config: Config,
  monitor: Monitor,
  calls: CallsContext = { store: new CallStore(), gateway: () => ({ state: "failed", certificate: "" }) },
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      // The send route's own refusals have their own shape, so a client can tell the Console saying no from an Emulator answer.
      const isSend = (req.url ?? "").split("?")[0] === "/api/send";
      const deny = (status: number, message: string, head = false) =>
        sendJson(res, status, isSend ? { kind: "refused", reason: status === 421 ? "host-not-allowed" : status === 405 ? "method-not-allowed" : "forbidden", message } : { error: message }, head);
      const refusal = checkRequest(req.headers, config.port, req.method);
      if (refusal) return deny(refusal.status, refusal.message);

      const url = new URL(req.url ?? "/", "http://console.invalid");
      const head = req.method === "HEAD";
      const method = (head ? "GET" : req.method) as Method;

      if (url.pathname.startsWith("/api/")) {
        const fetchRefusal = checkFetchSite(req.headers);
        if (fetchRefusal) return deny(fetchRefusal.status, fetchRefusal.message);
        const route = routes.find((r) => r.path === url.pathname);
        if (!route) return sendJson(res, 404, { error: "Not found" });
        const handler = route.methods[method];
        if (!handler) {
          res.setHeader("allow", Object.keys(route.methods).join(", "));
          return deny(405, "Method not allowed", head);
        }
        const reply = await handler({ config, monitor, calls, url, req });
        const etag = reply.headers?.etag;
        if (etag && req.headers["if-none-match"]?.split(",").some((t) => t.trim() === etag)) {
          res.writeHead(304, { ...SECURITY_HEADERS, ...reply.headers });
          return res.end();
        }
        if (reply.type) return send(res, reply.status, reply.type, String(reply.body), head, reply.headers);
        return sendJson(res, reply.status, reply.body, head, reply.headers);
      }

      if (method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
      const file = await readStatic(config.webRoot, url.pathname);
      if (!file) return sendJson(res, 404, { error: "Not found" }, head);
      return send(res, 200, file.type, file.body, head);
    } catch {
      sendJson(res, 500, { error: "Internal error" });
    }
  });
}
