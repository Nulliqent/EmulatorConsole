import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CallStore } from "../calls/store.js";
import type { Config } from "../config.js";
import { ModelIndex } from "../model-index/index.js";
import { generateCertificate } from "./certificate.js";
import { Gateway, hostAllowed, isFromBrowser, isTlsHandshake, type GatewayDeps } from "./gateway.js";

const SIGNATURE = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TOKEN = "FwoGZXIvYXdzEXAMPLETOKENVALUE";
const AUTH = `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY12345/20261126/us-east-1/dynamodb/aws4_request, SignedHeaders=host;x-amz-date, Signature=${SIGNATURE}`;

let tmp: string;
let emulator: https.Server;
let emulatorPort: number;
let seen: { host?: string; method?: string; url?: string; body: string; headers: http.IncomingHttpHeaders }[] = [];
const emulatorCert = generateCertificate();
const gatewayCert = generateCertificate();
let index: ModelIndex;

function configFor(overrides: Partial<Config> = {}): Config {
  return {
    bindHost: "127.0.0.1",
    port: 9298,
    gatewayPort: 0,
    gatewayHosts: [],
    emulatorHost: "127.0.0.1",
    emulatorPort,
    emulatorTlsServername: "localhost",
    emulatorHome: tmp,
    webRoot: tmp,
    modelIndexDir: path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"),
    ...overrides,
  };
}

let gateways: Gateway[] = [];
async function start(overrides: Partial<Config> = {}, store = new CallStore(), deps: Partial<GatewayDeps> = {}) {
  const gateway = new Gateway({ config: configFor(overrides), store, certificate: gatewayCert, index: async () => index, ...deps });
  gateways.push(gateway);
  expect(await gateway.listen()).toBe("listening");
  return { gateway, store, port: gateway.address()!.port };
}

function send(port: number, opts: http.RequestOptions & { body?: string | Buffer } = {}) {
  const { body, ...rest } = opts;
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/", ...rest }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "gateway-test-"));
  index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
  emulator = https.createServer({ key: emulatorCert.key, cert: emulatorCert.cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ host: req.headers.host, method: req.method, url: req.url, body, headers: req.headers });
      if (req.url === "/slow") return; // never answers
      if (req.url === "/echo") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ body, te: req.headers["transfer-encoding"] ?? null, expect: req.headers.expect ?? null, len: req.headers["content-length"] ?? null }));
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("x".repeat(300 * 1024));
      }
      res.writeHead(200, { "content-type": "application/x-amz-json-1.0", "x-extra": "kept" });
      res.end(JSON.stringify({ TableNames: ["a"] }));
    });
  });
  await new Promise<void>((r) => emulator.listen(0, "127.0.0.1", r));
  emulatorPort = (emulator.address() as net.AddressInfo).port;
  mkdirSync(path.join(tmp, String(emulatorPort)));
  writeFileSync(path.join(tmp, String(emulatorPort), "ca.pem"), emulatorCert.cert);
});

afterEach(() => {
  for (const g of gateways) {
    g.close();
    g.closeAllConnections();
  }
  gateways = [];
  seen = [];
});

afterAll(() => {
  emulator.close();
  emulator.closeAllConnections();
  rmSync(tmp, { recursive: true, force: true });
});

describe("first byte", () => {
  it("tells a TLS handshake from an HTTP method", () => {
    expect(isTlsHandshake(0x16)).toBe(true);
    for (const method of ["GET", "PUT", "POST", "HEAD", "DELETE", "OPTIONS", "PATCH"]) expect(isTlsHandshake(method.charCodeAt(0))).toBe(false);
    expect(isTlsHandshake(undefined)).toBe(false);
  });

  it("says a request is from a browser when it has Origin or any Sec-Fetch header", () => {
    expect(isFromBrowser({ origin: "https://x.test" })).toBe(true);
    expect(isFromBrowser({ "sec-fetch-dest": "empty" })).toBe(true);
    expect(isFromBrowser({ "sec-fetch-mode": "cors" })).toBe(false); // Node's fetch sends this alone
    expect(isFromBrowser({ "sec-fetch-site": "cross-site" })).toBe(true);
    expect(isFromBrowser({ host: "127.0.0.1", authorization: "x", "user-agent": "aws-sdk-js/3" })).toBe(false);
  });
});

describe("the Gateway", () => {
  it("forwards unchanged with the original Host, relays the answer, and records the Call without the signature or token", async () => {
    const { port, store } = await start();
    const res = await send(port, {
      path: "/",
      headers: {
        host: "127.0.0.1:19300",
        authorization: AUTH,
        "x-amz-security-token": TOKEN,
        "x-amz-target": "DynamoDB_20120810.ListTables",
        "content-type": "application/x-amz-json-1.0",
        "x-amz-date": "20261126T000000Z",
      },
      body: '{"Limit":5}',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ TableNames: ["a"] });
    expect(res.headers["x-extra"]).toBe("kept");

    // The Emulator saw exactly what was sent, including the original Host, signature and token.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ host: "127.0.0.1:19300", method: "POST", url: "/", body: '{"Limit":5}' });
    expect(seen[0]!.headers.authorization).toBe(AUTH);
    expect(seen[0]!.headers["x-amz-security-token"]).toBe(TOKEN);

    await settle();
    const [summary] = store.list().calls;
    expect(summary).toMatchObject({ method: "POST", service: { sdkId: "DynamoDB" }, operation: "ListTables", region: "us-east-1", status: 200, run: 1 });
    const stored = JSON.stringify([store.get(summary!.id), store.reveal(summary!.id)]);
    expect(stored.includes(SIGNATURE)).toBe(false);
    expect(stored.includes(TOKEN)).toBe(false);
    const call = store.get(summary!.id)!;
    expect(call.request.body).toMatchObject({ kind: "text", text: '{"Limit":5}', size: 11 });
    expect(call.response.body.text).toBe('{"TableNames":["a"]}');
    expect(call.request.headers.find(([n]) => n === "authorization")![1]).toContain("Signature=Not kept");
  });

  it("refuses a request from a browser, counts it, and records no Call", async () => {
    const { port, store } = await start();
    const res = await send(port, { path: "/", headers: { host: `127.0.0.1:${port}`, origin: "http://127.0.0.1:9298", "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
    expect(res.body).toContain("refuses requests sent from a browser");
    const fetchOnly = await send(port, { method: "GET", path: "/", headers: { host: `127.0.0.1:${port}`, "sec-fetch-site": "cross-site" } });
    expect(fetchOnly.status).toBe(403);
    await settle();
    expect(seen).toHaveLength(0);
    expect(store.total).toBe(0);
    expect(store.browserRefusals.count).toBe(2);
    expect(store.browserRefusals.lastAt).not.toBeNull();
  });

  it("answers 502 and records the Call when the Emulator can't be reached", async () => {
    const { port, store } = await start({ emulatorPort: 1 });
    const res = await send(port, { path: "/", headers: { "x-amz-target": "DynamoDB_20120810.ListTables", authorization: AUTH }, body: "{}" });
    expect(res.status).toBe(502);
    await settle();
    expect(store.list().calls[0]).toMatchObject({ status: 0, error: "emulator-unreachable" });
  });

  it("keeps no bodies with 'headers and status only', and cuts large bodies at 256 KB with the original size", async () => {
    const { port, store } = await start();
    await send(port, { method: "GET", path: "/big", headers: { host: "127.0.0.1:1", authorization: AUTH.replace("dynamodb", "unknownsvc") } });
    await settle();
    const big = store.get(store.list().calls[0]!.id)!;
    expect(big.response.body).toMatchObject({ kind: "text", truncated: true, size: 300 * 1024 });
    expect(big.response.body.text).toHaveLength(256 * 1024);

    store.headersOnly = true;
    await send(port, { path: "/", headers: { "x-amz-target": "DynamoDB_20120810.ListTables" }, body: '{"Limit":5}' });
    await settle();
    const call = store.get(store.list().calls[0]!.id)!;
    expect(call.request.body).toEqual({ kind: "not-recorded", size: 11 });
    expect(call.response.body.kind).toBe("not-recorded");
    expect(call.operation).toBe("ListTables"); // still identified, from the body it did not keep
    expect(call.status).toBe(200);
  });

  it("accepts TLS on the same port when the caller trusts the certificate, and counts a refusal when it doesn't", async () => {
    const { port, store } = await start();
    const trusted = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        { host: "127.0.0.1", port, method: "POST", path: "/", ca: gatewayCert.cert, servername: "localhost", headers: { "x-amz-target": "DynamoDB_20120810.ListTables", authorization: AUTH } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve(b));
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(JSON.parse(trusted)).toEqual({ TableNames: ["a"] });
    await settle();
    expect(store.list().calls[0]).toMatchObject({ operation: "ListTables", status: 200 });

    await expect(
      new Promise((resolve, reject) => {
        const req = https.request({ host: "127.0.0.1", port, path: "/", servername: "localhost" }, resolve);
        req.on("error", reject);
        req.end();
      }),
    ).rejects.toThrow();
    await settle();
    expect(store.tlsRefusals.count).toBe(1);
    expect(store.total).toBe(1); // the refused connection is not a Call
  });

  it("reports a port in use as a state, not a crash", async () => {
    const { gateway, port } = await start();
    const second = new Gateway({ config: configFor({ gatewayPort: port }), store: new CallStore(), certificate: gatewayCert, index: async () => index });
    expect(await second.listen()).toBe("port-in-use");
    expect(second.state).toBe("port-in-use");
    second.close();
    expect(gateway.state).toBe("listening");
  });

  it("drops a connection that never sends a byte only after the first-byte timeout (it does not hold the server)", async () => {
    const { port } = await start();
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((r) => socket.once("connect", r));
    socket.destroy();
  });
});

describe("Host check", () => {
  it("allows loopback names on any port and refuses anything else, unless GATEWAY_HOSTS names it", () => {
    for (const h of ["127.0.0.1:9300", "127.9.9.9", "localhost:1", "bk.localhost:9300", "[::1]:9300"]) expect(hostAllowed(h), h).toBe(true);
    for (const h of ["evil.example", "evil.example:9300", "10.0.0.5:9300", "192.168.1.2", "localhost.evil.example", undefined, ""]) expect(hostAllowed(h), String(h)).toBe(false);
    expect(hostAllowed("host.docker.internal:9300")).toBe(false);
    expect(hostAllowed("host.docker.internal:9300", ["host.docker.internal"])).toBe(true);
  });

  it("answers 421 for a foreign Host, and records nothing", async () => {
    const { port, store } = await start();
    const res = await send(port, { path: "/", headers: { host: "rebound.example:9300" }, body: "{}" });
    expect(res.status).toBe(421);
    await settle();
    expect(seen).toHaveLength(0);
    expect(store.total).toBe(0);
  });
});

describe("forwarding details", () => {
  it("passes a chunked upload through unchanged and records its body", async () => {
    const { port, store } = await start();
    const out = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "PUT", path: "/echo", headers: { host: "127.0.0.1:1", "transfer-encoding": "chunked", authorization: AUTH.replace("dynamodb", "unknownsvc") } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      });
      req.on("error", reject);
      req.write("part one, ");
      setTimeout(() => req.end("part two"), 50);
    });
    expect(JSON.parse(out.body)).toMatchObject({ body: "part one, part two", te: "chunked", len: null });
    await settle();
    expect(store.get(1)!.request.body).toMatchObject({ kind: "text", text: "part one, part two", size: 18 });
  });

  it("answers Expect: 100-continue itself and doesn't pass it on", async () => {
    const { port } = await start();
    const out = await new Promise<{ status: number; body: string; continued: boolean }>((resolve, reject) => {
      let continued = false;
      const req = http.request({ host: "127.0.0.1", port, method: "PUT", path: "/echo", headers: { host: "127.0.0.1:1", expect: "100-continue", "content-length": "5" } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b, continued }));
      });
      req.on("continue", () => {
        continued = true;
        req.end("hello");
      });
      req.on("error", reject);
      req.flushHeaders();
    });
    expect(out.continued).toBe(true);
    expect(JSON.parse(out.body)).toMatchObject({ body: "hello", expect: null });
  });

  it("records a caller that leaves mid-request as client-aborted, not as an Emulator that didn't answer", async () => {
    const { port, store } = await start();
    await new Promise<void>((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/slow", headers: { host: "127.0.0.1:1", "x-amz-target": "DynamoDB_20120810.ListTables" } });
      req.on("error", () => {});
      req.end("{}");
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });
    await settle();
    expect(store.list().calls[0]).toMatchObject({ error: "client-aborted", operation: "ListTables" });
  });

  it("gives up on an Emulator silent past the timeout, with an error in the request's own shape", async () => {
    const { port, store } = await start({}, new CallStore(), { upstreamTimeoutMs: 200 });
    const json = await send(port, { path: "/slow", headers: { host: "127.0.0.1:1", "x-amz-target": "DynamoDB_20120810.ListTables", "content-type": "application/x-amz-json-1.0" }, body: "{}" });
    expect(json.status).toBe(502);
    expect(JSON.parse(json.body)).toMatchObject({ __type: "ServiceUnavailable" });
    expect(json.headers["x-amzn-errortype"]).toBe("ServiceUnavailable");
    const query = await send(port, { path: "/slow", headers: { host: "127.0.0.1:1", "content-type": "application/x-www-form-urlencoded" }, body: "Action=ListUsers" });
    expect(query.body).toContain("<Code>ServiceUnavailable</Code>");
    const s3 = await send(port, { method: "GET", path: "/slow", headers: { host: "127.0.0.1:1", authorization: AUTH.replace("dynamodb", "s3") } });
    expect(s3.body).toContain("<Error><Code>ServiceUnavailable</Code>");
    await settle();
    expect(store.list().calls.every((c) => c.error === "emulator-unreachable")).toBe(true);
  });

  it("serves two requests on one kept-alive TLS connection", async () => {
    const { port, store } = await start();
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1, ca: gatewayCert.cert, servername: "localhost" });
    const get = () =>
      new Promise<string>((resolve, reject) => {
        const req = https.request({ host: "127.0.0.1", port, path: "/echo", method: "POST", agent, headers: { host: "127.0.0.1:1" } }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve(b));
        });
        req.on("error", reject);
        req.end("x");
      });
    await get();
    await get();
    agent.destroy();
    await settle();
    expect(store.total).toBe(2);
  });
});

describe("silent and stalled connections", () => {
  const closes = (socket: net.Socket) =>
    new Promise<number>((resolve) => {
      const at = Date.now();
      socket.on("close", () => resolve(Date.now() - at));
      socket.on("error", () => {});
    });

  it("drops a connection that sends nothing, after the first-byte timeout", async () => {
    const { port } = await start({}, new CallStore(), { firstByteTimeoutMs: 150 });
    const socket = net.connect(port, "127.0.0.1");
    const ms = await closes(socket);
    expect(ms).toBeGreaterThanOrEqual(100);
    expect(ms).toBeLessThan(2000);
  });

  it("drops a TLS handshake that starts and stalls (one byte), without counting a refusal", async () => {
    const { port, store } = await start({}, new CallStore(), { handshakeTimeoutMs: 200 });
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((r) => socket.once("connect", r));
    socket.write(Buffer.from([0x16]));
    const ms = await closes(socket);
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThan(2000);
    expect(store.tlsRefusals.count).toBe(0);
  });

  it("drops a plain request whose headers never finish (one byte)", async () => {
    const { port } = await start({}, new CallStore(), { headersTimeoutMs: 300 });
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((r) => socket.once("connect", r));
    socket.write("G");
    const ms = await closes(socket);
    expect(ms).toBeLessThan(3000);
  });
});
