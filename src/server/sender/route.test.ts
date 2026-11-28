import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createMonitorFor } from "../monitor.js";
import { FAKE_SECRET, startFakeEmulator } from "./fake-emulator.testkit.js";
import type { FakeEmulator } from "./fake-emulator.testkit.js";
import { MAX_SENDS_IN_FLIGHT } from "./route.js";

let emu: FakeEmulator;
let server: http.Server;
let port: number;

beforeAll(async () => {
  emu = await startFakeEmulator();
  // The app answers to its own port only, so find a free one first.
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  emu.config.port = port;
  server = createApp(emu.config, createMonitorFor(emu.config));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await emu.close();
});

function post(body: string | Buffer, headers: Record<string, string> = {}, method = "POST") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const all = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json", ...headers };
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/send", method, headers: Object.fromEntries(Object.entries(all).filter(([, v]) => v !== "")) },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const request = { sdkId: "SQS", operation: "ListQueues", region: "us-east-1", input: {} };
const kind = (res: { body: string }) => JSON.parse(res.body) as { kind: string; reason?: string; message?: string; eventStream?: boolean };

describe("POST /api/send", () => {
  it("sends and returns the parsed answer without credentials", async () => {
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ QueueUrls: ["https://localhost/0/q"] }) }));
    const res = await post(JSON.stringify(request));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ kind: "response", status: 200, output: { QueueUrls: ["https://localhost/0/q"] } });
    expect(res.body).not.toContain(FAKE_SECRET);
    expect(res.body.toLowerCase()).not.toContain("authorization");
  });

  it("refuses, in the refused shape, a request without the Console's Origin or same-origin Fetch Metadata", async () => {
    const before = emu.seen.length;
    const res = await post(JSON.stringify(request), { origin: "" }); // "" leaves the header out
    expect(res.status).toBe(403);
    expect(kind(res)).toMatchObject({ kind: "refused", reason: "forbidden" });
    expect((await post(JSON.stringify(request), { origin: "https://evil.example" })).status).toBe(403);
    expect(emu.seen.length).toBe(before);
    // Fetch Metadata can stand in for Origin; a cross-site one cannot.
    expect((await post(JSON.stringify(request), { origin: "", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await post(JSON.stringify(request), { origin: "", "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("refuses a foreign Host in the refused shape", async () => {
    const res = await post(JSON.stringify(request), { host: "evil.example" });
    expect(res.status).toBe(421);
    expect(kind(res)).toMatchObject({ kind: "refused", reason: "host-not-allowed" });
  });

  it("wants application/json or X-Console", async () => {
    expect((await post(JSON.stringify(request), { "content-type": "text/plain" })).status).toBe(403);
    expect((await post("a=b", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
    expect((await post(JSON.stringify(request), { "content-type": "text/plain", "x-console": "1" })).status).toBe(200);
    expect((await post(JSON.stringify(request), { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("answers 405 to GET, and 400 to a malformed body, in the refused shape", async () => {
    const get = await post("", {}, "GET");
    expect(get.status).toBe(405);
    expect(kind(get)).toMatchObject({ kind: "refused", reason: "method-not-allowed" });
    expect(kind(await post("{not json"))).toMatchObject({ kind: "refused", reason: "bad-json" });
    expect((await post(JSON.stringify([1]))).status).toBe(400);
    expect((await post(JSON.stringify({ ...request, sendInvalid: "yes" }))).status).toBe(400);
  });

  it("answers 404 refused for an unknown service or operation, never as the Emulator's UnknownService", async () => {
    const service = await post(JSON.stringify({ ...request, sdkId: "Nope" }));
    expect(service.status).toBe(404);
    expect(kind(service)).toMatchObject({ kind: "refused", reason: "unknown-service" });
    const op = await post(JSON.stringify({ ...request, operation: "Nope" }));
    expect(kind(op)).toMatchObject({ kind: "refused", reason: "unknown-operation" });
    expect(kind(await post(JSON.stringify({ ...request, region: "../x" })))).toMatchObject({ kind: "refused", reason: "invalid-region" });
  });

  it("refuses an event-stream operation with a flag, and sends nothing", async () => {
    const before = emu.seen.length;
    const res = await post(JSON.stringify({ sdkId: "S3", operation: "SelectObjectContent", region: "us-east-1", input: {} }));
    expect(res.status).toBe(422);
    expect(kind(res)).toMatchObject({ kind: "refused", reason: "event-stream", eventStream: true, message: "Event streams can't be sent from the Console." });
    expect(emu.seen.length).toBe(before);
  });

  it("caps the request body", async () => {
    const big = JSON.stringify({ ...request, input: { pad: "x".repeat(9 * 1024 * 1024) } });
    const res = await post(big).catch(() => ({ status: 0, body: "" }));
    // The server may answer 413 or close the connection before the whole body is sent.
    expect([413, 0]).toContain(res.status);
  });

  it("returns invalid input without sending, and the same input when sendInvalid is set", async () => {
    const before = emu.seen.length;
    const bad = { sdkId: "DynamoDB", operation: "CreateTable", region: "us-east-1", input: { TableName: "" } };
    expect(kind(await post(JSON.stringify(bad))).kind).toBe("invalid");
    expect(emu.seen.length).toBe(before);
    emu.answer(() => ({ status: 400, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "ValidationException", message: "no" }) }));
    const sent = JSON.parse((await post(JSON.stringify({ ...bad, sendInvalid: true }))).body) as { kind: string; problems: unknown[] };
    expect(sent.kind).toBe("response");
    expect(sent.problems.length).toBeGreaterThan(0);
    expect(emu.seen.length).toBe(before + 1);
  });

  it("cancels the send, and closes the upstream connection, when the browser's connection closes", async () => {
    emu.answer(() => ({ hang: true }));
    const before = emu.seen.length;
    await new Promise<void>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/send", method: "POST", headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" } });
      req.on("error", () => resolve());
      req.end(JSON.stringify(request));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 300);
    });
    expect(emu.seen.length).toBe(before + 1);
    // The Emulator's side of the connection closes: the Console did not leave the request hanging.
    await emu.seen.at(-1)!.closed;
    emu.answer(() => ({ status: 200, body: "{}" }));
  });

  it("refuses with 503 beyond the sends in flight, and recovers", async () => {
    emu.answer(() => ({ hang: true }));
    const hung = Array.from({ length: MAX_SENDS_IN_FLIGHT }, () => {
      const req = http.request({ host: "127.0.0.1", port, path: "/api/send", method: "POST", headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" } });
      req.on("error", () => undefined);
      req.end(JSON.stringify(request));
      return req;
    });
    await new Promise((r) => setTimeout(r, 400));
    const res = await post(JSON.stringify(request));
    expect(res.status).toBe(503);
    expect(kind(res)).toMatchObject({ kind: "refused", reason: "busy" });
    for (const r of hung) r.destroy();
    await new Promise((r) => setTimeout(r, 300));
    emu.answer(() => ({ status: 200, body: "{}" }));
    expect((await post(JSON.stringify(request))).status).toBe(200);
  });
});
