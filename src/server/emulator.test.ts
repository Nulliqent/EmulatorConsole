import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { checkEmulatorHealth } from "./emulator.js";

let tmp: string;
let server: https.Server;
let port: number;
let status = 200;
let good: { key: Buffer; cert: Buffer };
let other: { key: Buffer; cert: Buffer };

function makeCert(name: string) {
  const key = path.join(tmp, `${name}-key.pem`);
  const cert = path.join(tmp, `${name}-cert.pem`);
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
      "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function configFor(home: string): Config {
  return {
    bindHost: "127.0.0.1",
    port: 9298,
    gatewayPort: 9300,
    emulatorHost: "127.0.0.1",
    emulatorPort: port,
    emulatorHome: home,
    webRoot: tmp,
    modelIndexDir: path.join(tmp, "model-index"),
  };
}

function homeWithCa(name: string, ca: Buffer): string {
  const home = path.join(tmp, name);
  mkdirSync(path.join(home, String(port)), { recursive: true });
  writeFileSync(path.join(home, String(port), "ca.pem"), ca);
  return home;
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "console-emu-"));
  good = makeCert("good");
  other = makeCert("other");
  server = https.createServer(good, (req, res) => {
    res.writeHead(req.url === "/__admin/health" ? status : 404);
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("checkEmulatorHealth", () => {
  it("is reachable when health answers 200 and the certificate chains to ca.pem", async () => {
    status = 200;
    expect(await checkEmulatorHealth(configFor(homeWithCa("a", good.cert)))).toEqual({ reachable: true, port });
  });

  it("reports no-ca when ca.pem is missing", async () => {
    const res = await checkEmulatorHealth(configFor(path.join(tmp, "nowhere")));
    expect(res).toEqual({ reachable: false, port, reason: "no-ca" });
  });

  it("reports refused, not no-ca, when ca.pem is missing and nothing is listening", async () => {
    const res = await checkEmulatorHealth({ ...configFor(path.join(tmp, "nowhere")), emulatorPort: 1 });
    expect(res).toEqual({ reachable: false, port: 1, reason: "refused" });
  });

  it("does not trust a certificate from a different CA", async () => {
    status = 200;
    const res = await checkEmulatorHealth(configFor(homeWithCa("b", other.cert)));
    expect(res).toEqual({ reachable: false, port, reason: "untrusted" });
  });

  it("reports refused when nothing is listening", async () => {
    const home = path.join(tmp, "d");
    mkdirSync(path.join(home, "1"), { recursive: true });
    writeFileSync(path.join(home, "1", "ca.pem"), good.cert);
    expect(await checkEmulatorHealth({ ...configFor(home), emulatorPort: 1 })).toEqual({ reachable: false, port: 1, reason: "refused" });
  });

  it("reports unhealthy on a non-200 answer", async () => {
    status = 503;
    const res = await checkEmulatorHealth(configFor(homeWithCa("c", good.cert)));
    expect(res).toEqual({ reachable: false, port, reason: "unhealthy" });
  });
});
