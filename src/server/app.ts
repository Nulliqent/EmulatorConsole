import http from "node:http";
import type { HealthResponse } from "../shared/api.js";
import type { ServiceResponse, ServicesResponse, ShapesResponse } from "../shared/models.js";
import type { Config } from "./config.js";
import { checkFetchSite, checkRequest } from "./guard.js";
import { modelIndex } from "./model-index/index.js";
import type { Monitor } from "./monitor.js";
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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Reply = { status: number; type?: string; body: unknown; headers?: Record<string, string> };
type Handler = (ctx: { config: Config; monitor: Monitor; url: URL; req: http.IncomingMessage }) => Promise<Reply> | Reply;

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
];

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

/** The caller creates and starts `monitor` (main.ts does); tests pass their own. */
export function createApp(config: Config, monitor: Monitor): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const refusal = checkRequest(req.headers, config.port, req.method);
      if (refusal) return sendJson(res, refusal.status, { error: refusal.message });

      const url = new URL(req.url ?? "/", "http://console.invalid");
      const head = req.method === "HEAD";
      const method = (head ? "GET" : req.method) as Method;

      if (url.pathname.startsWith("/api/")) {
        const fetchRefusal = checkFetchSite(req.headers);
        if (fetchRefusal) return sendJson(res, fetchRefusal.status, { error: fetchRefusal.message });
        const route = routes.find((r) => r.path === url.pathname);
        if (!route) return sendJson(res, 404, { error: "Not found" });
        const handler = route.methods[method];
        if (!handler) {
          res.setHeader("allow", Object.keys(route.methods).join(", "));
          return sendJson(res, 405, { error: "Method not allowed" }, head);
        }
        const reply = await handler({ config, monitor, url, req });
        const etag = reply.headers?.etag;
        if (etag && req.headers["if-none-match"]?.split(",").some((t) => t.trim() === etag)) {
          res.writeHead(304, { ...SECURITY_HEADERS, ...reply.headers });
          return res.end();
        }
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
