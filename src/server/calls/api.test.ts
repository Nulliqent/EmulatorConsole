import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import type { Monitor } from "../monitor.js";
import { CallStore } from "./store.js";

const store = new CallStore();
const monitor = { current: async () => ({ restartedAt: null }) } as unknown as Monitor;
let server: http.Server;
let port: number;

const call = (path: string, hidden = 0) => ({
  startedAt: "2026-11-26T10:00:00.000Z", durationMs: 1, method: "GET", path, query: "", status: 200, hidden,
  request: { headers: [] as [string, string][], body: { kind: "none" as const, size: 0 } },
  response: { headers: [] as [string, string][], body: { kind: "none" as const, size: 0 } },
});

function call_(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const same = () => ({ origin: `http://127.0.0.1:${port}`, "content-type": "application/json" });

beforeAll(async () => {
  const config = { bindHost: "127.0.0.1", port: 0, gatewayPort: 1, emulatorHost: "127.0.0.1", emulatorPort: 1, emulatorHome: "/", webRoot: "/", modelIndexDir: "/" } as Config;
  server = createApp(config, monitor, { store, gateway: () => ({ state: "listening", certificate: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n" }) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  // The app checks Host against its configured port.
  (config as { port: number }).port = port;
});
afterAll(() => server.close());

describe("the Calls API", () => {
  it("lists, gets, and sends hidden values only through reveal", async () => {
    store.add({ call: call("/a") });
    store.add({ call: call("/Hidden", 1), restore: { path: "/secret" } });
    const list = JSON.parse((await call_("GET", "/api/calls?limit=10")).text);
    expect(list.calls.map((c: { path: string }) => c.path)).toEqual(["/Hidden", "/a"]);
    expect(list.calls[0].request).toBeUndefined();
    const got = await call_("GET", "/api/calls/get?id=2");
    expect(got.text).not.toContain("secret");
    expect((await call_("GET", "/api/calls/get?id=99")).status).toBe(404);
    const shown = await call_("POST", "/api/calls/reveal", same(), { id: 2 });
    expect(JSON.parse(shown.text).call.path).toBe("/secret");
    expect((await call_("GET", "/api/calls?limit=abc")).status).toBe(400);
  });

  it("takes the stricter rule on every change: reveal, clear and the setting", async () => {
    for (const [p, body] of [["/api/calls/reveal", { id: 1 }], ["/api/calls/clear", {}], ["/api/gateway/settings", { headersOnly: true }]] as const) {
      expect((await call_("POST", p, { "content-type": "application/json" }, body)).status, `${p} with no Origin`).toBe(403);
      expect((await call_("POST", p, { ...same(), origin: "http://evil.example" }, body)).status, `${p} foreign Origin`).toBe(403);
      expect((await call_("GET", p)).status, `${p} GET`).toBe(405);
    }
    expect(store.headersOnly).toBe(false);
    expect(store.total).toBe(2);
  });

  it("sets the setting, reports the Gateway, serves only the certificate, and clears", async () => {
    const set = await call_("POST", "/api/gateway/settings", same(), { headersOnly: true });
    expect(JSON.parse(set.text)).toMatchObject({ state: "listening", headersOnly: true, total: 2, firstCall: { id: 1 } });
    expect((await call_("POST", "/api/gateway/settings", same(), { headersOnly: "yes" })).status).toBe(400);
    const cert = await call_("GET", "/api/gateway/certificate");
    expect(cert.text).toContain("BEGIN CERTIFICATE");
    const cleared = await call_("POST", "/api/calls/clear", same(), {});
    expect(JSON.parse(cleared.text)).toEqual({ cleared: 2 });
    expect(JSON.parse((await call_("GET", "/api/gateway")).text).firstCall).toBeNull();
  });
});
