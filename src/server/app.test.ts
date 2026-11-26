import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Config } from "./config.js";

const SECRET_KEY_ID = "AKIATESTKEYIDSHOULDNEVERLEAK";
const SECRET = "test/secret+value/should-never-leak-0123456789";

let tmp: string;
let fake: https.Server;
let consoleServer: http.Server;
let config: Config;

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function request(method: string, headers: Record<string, string>, urlPath: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: config.port, path: urlPath, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function get(headers: Record<string, string>, urlPath = "/api/health") {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: config.port, path: urlPath, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "console-test-"));
  const key = path.join(tmp, "key.pem");
  const cert = path.join(tmp, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
    "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });

  fake = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    res.writeHead(req.url === "/__admin/health" ? 200 : 404);
    res.end(req.url === "/__admin/health" ? "ok" : "");
  });
  const emulatorPort = await listen(fake);

  const run = path.join(tmp, "home", String(emulatorPort));
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, "ca.pem"), readFileSync(cert));
  writeFileSync(
    path.join(run, "emulator_credentials"),
    `[default]\naws_access_key_id = ${SECRET_KEY_ID}\naws_secret_access_key = ${SECRET}\n`,
  );
  const web = path.join(tmp, "web");
  mkdirSync(web);
  writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Emulator Console</title>");
  mkdirSync(path.join(web, "assets"));
  writeFileSync(path.join(web, "assets", "app.js"), "console.log(1)");
  writeFileSync(path.join(tmp, "outside.txt"), "outside the web root");
  symlinkSync(path.join(tmp, "outside.txt"), path.join(web, "assets", "link.txt"));

  config = {
    bindHost: "127.0.0.1",
    port: await freePort(),
    gatewayPort: 9300,
    emulatorHost: "127.0.0.1",
    emulatorPort,
    emulatorHome: path.join(tmp, "home"),
    webRoot: web,
  };
  consoleServer = createApp(config);
  await new Promise<void>((r) => consoleServer.listen(config.port, "127.0.0.1", r));
});

afterAll(() => {
  consoleServer.close();
  fake.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Host and Origin checks", () => {
  it("answers a loopback Host", async () => {
    const res = await get({ host: `localhost:${config.port}` });
    expect(res.status).toBe(200);
  });

  it("refuses a foreign Host", async () => {
    expect((await get({ host: "evil.example" })).status).toBe(421);
    expect((await get({ host: `evil.example:${config.port}` }, "/")).status).toBe(421);
  });

  it("refuses a foreign Origin", async () => {
    const res = await get({ host: `127.0.0.1:${config.port}`, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("accepts the Console's own Origin", async () => {
    const res = await get({ host: `127.0.0.1:${config.port}`, origin: `http://127.0.0.1:${config.port}` });
    expect(res.status).toBe(200);
  });
});

describe("API", () => {
  const host = () => ({ host: `127.0.0.1:${config.port}` });

  it("reports the Emulator reachable when /__admin/health answers over its own CA", async () => {
    const res = await get(host());
    expect(JSON.parse(res.body)).toEqual({ emulator: { reachable: true, port: config.emulatorPort } });
  });

  it("never sends the Emulator's credentials in any response", async () => {
    const paths = ["/", "/index.html", "/assets/app.js", "/api/health", "/api/nothing", "/assets/missing.js", "/some/route"];
    for (const p of paths) {
      const res = await get(host(), p);
      const everything = JSON.stringify(res.headers) + res.body;
      expect(everything, p).not.toContain(SECRET);
      expect(everything, p).not.toContain(SECRET_KEY_ID);
    }
  });
});

describe("static files", () => {
  const host = () => ({ host: `127.0.0.1:${config.port}` });

  it("serves the shell and falls back to it for client routes, dots included", async () => {
    expect((await get(host(), "/")).body).toContain("Emulator Console");
    expect((await get(host(), "/services/s3")).body).toContain("Emulator Console");
    expect((await get(host(), "/services/s3/buckets/my.bucket")).body).toContain("Emulator Console");
  });

  it("serves built assets and returns 404 for a missing one", async () => {
    expect((await get(host(), "/assets/app.js")).body).toBe("console.log(1)");
    expect((await get(host(), "/assets/missing.js")).status).toBe(404);
  });

  it("refuses path traversal and symlinks that leave the web root", async () => {
    const traversal = await get(host(), "/assets/..%2f..%2foutside.txt");
    expect(traversal.body).not.toContain("outside the web root");
    const link = await get(host(), "/assets/link.txt");
    expect(link.status).toBe(404);
    expect(link.body).not.toContain("outside the web root");
  });

  it("sets security headers", async () => {
    const res = await get(host(), "/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
    );
  });
});

describe("methods", () => {
  const host = () => ({ host: `127.0.0.1:${config.port}` });

  it("answers 405 with Allow for an unknown method on a known route", async () => {
    const res = await request("POST", host(), "/api/health");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET");
  });

  it("still applies the Origin rule before the method", async () => {
    const res = await request("POST", { ...host(), origin: "https://evil.example" }, "/api/health");
    expect(res.status).toBe(403);
  });

  it("answers HEAD on a GET route without a body", async () => {
    const res = await request("HEAD", host(), "/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });
});
