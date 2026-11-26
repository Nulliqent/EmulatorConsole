import http from "node:http";
import type { HealthResponse } from "../shared/api.js";
import type { Config } from "./config.js";
import { checkEmulatorHealth } from "./emulator.js";
import { checkRequest } from "./guard.js";
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
type Reply = { status: number; type?: string; body: unknown };
type Handler = (ctx: { config: Config; url: URL; req: http.IncomingMessage }) => Promise<Reply> | Reply;

/** One entry per API path; each declares the methods it answers. Later tickets add routes here. */
type Route = { path: string; methods: Partial<Record<Method, Handler>> };

const routes: Route[] = [
  {
    path: "/api/health",
    methods: {
      // Health checks are not AWS calls; they never carry credentials.
      GET: async ({ config }): Promise<Reply> => ({
        status: 200,
        body: { emulator: await checkEmulatorHealth(config) } satisfies HealthResponse,
      }),
    },
  },
];

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer, head = false) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type });
  res.end(head ? undefined : body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown, head = false) {
  send(res, status, "application/json", JSON.stringify(value), head);
}

export function createApp(config: Config): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const refusal = checkRequest(req.headers, config.port);
      if (refusal) return sendJson(res, refusal.status, { error: refusal.message });

      const url = new URL(req.url ?? "/", "http://console.invalid");
      const head = req.method === "HEAD";
      const method = (head ? "GET" : req.method) as Method;

      if (url.pathname.startsWith("/api/")) {
        const route = routes.find((r) => r.path === url.pathname);
        if (!route) return sendJson(res, 404, { error: "Not found" });
        const handler = route.methods[method];
        if (!handler) {
          res.setHeader("allow", Object.keys(route.methods).join(", "));
          return sendJson(res, 405, { error: "Method not allowed" }, head);
        }
        const reply = await handler({ config, url, req });
        return sendJson(res, reply.status, reply.body, head);
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
