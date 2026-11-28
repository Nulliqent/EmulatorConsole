import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import * as serde from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { SignatureV4 } from "@smithy/signature-v4";
import type { Config } from "../config.js";

// A stand-in Emulator for tests: an HTTPS server with a throwaway certificate, and a run folder (`<port>/ca.pem`,
// `<port>/emulator_credentials`) laid out as the Emulator lays it out. Tests script what it answers.

export const FAKE_ACCESS_KEY = "AKIAFAKEKEY1234567890";
export const FAKE_SECRET = "fakeSecretValue/abcdefghijklmnopqrstuvwxyz0123456789";

export type Seen = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** The request's SigV4 signature, recomputed here from the run's keys, matched the one it carried. */
  signatureValid: boolean;
  /** Resolves when the connection this request came on is closed. */
  closed: Promise<void>;
};

/** Recomputes the request's SigV4 signature the way a server would, from what arrived. */
async function verifySignature(req: http.IncomingMessage, body: Buffer): Promise<boolean> {
  try {
    const auth = req.headers.authorization ?? "";
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/.exec(auth);
    if (!m || m[1] !== FAKE_ACCESS_KEY) return false;
    const region = m[3]!;
    const service = m[4]!;
    const headers: Record<string, string> = {};
    for (const name of m[5]!.split(";")) {
      if (["x-amz-date", "x-amz-content-sha256"].includes(name)) continue;
      const v = req.headers[name];
      if (v === undefined) return false;
      headers[name] = Array.isArray(v) ? v.join(",") : v;
    }
    const [pathname, qs = ""] = (req.url ?? "").split("?");
    const query: Record<string, string | string[]> = {};
    for (const [k, v] of new URLSearchParams(qs)) query[k] = k in query ? [...[query[k]!].flat(), v] : v;
    const iso = String(req.headers["x-amz-date"]);
    const date = new Date(`${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}T${iso.slice(9, 11)}:${iso.slice(11, 13)}:${iso.slice(13, 15)}Z`);
    const signer = new SignatureV4({
      service, region, credentials: { accessKeyId: FAKE_ACCESS_KEY, secretAccessKey: FAKE_SECRET },
      sha256: serde.Hash.bind(null, "sha256") as never, uriEscapePath: service !== "s3", applyChecksum: true,
    });
    const signed = (await signer.sign(
      new HttpRequest({ method: req.method ?? "GET", protocol: "https:", hostname: String(headers.host).split(":")[0]!, path: pathname!, query, headers, body: body.length ? body : undefined }),
      { signingDate: date },
    )) as HttpRequest;
    return signed.headers.authorization === auth;
  } catch {
    return false;
  }
}
export type Answer = { status?: number; headers?: Record<string, string>; body?: string | Buffer; hang?: boolean };

export type FakeEmulator = {
  config: Config;
  home: string;
  seen: Seen[];
  /** Sets what the next requests answer. */
  answer(fn: (seen: Seen) => Answer): void;
  close(): Promise<void>;
};

export function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function startFakeEmulator(): Promise<FakeEmulator> {
  const home = mkdtempSync(path.join(os.tmpdir(), "fake-emulator-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(home, "key.pem"), "-out", path.join(home, "cert.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    { stdio: "ignore" },
  );
  const seen: Seen[] = [];
  let respond: (s: Seen) => Answer = () => ({ status: 200, body: "{}" });
  const sockets = new Set<import("node:stream").Duplex>();
  const server = https.createServer({ key: readFileSync(path.join(home, "key.pem")), cert: readFileSync(path.join(home, "cert.pem")) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    const closed = new Promise<void>((resolve) => req.socket.once("close", () => resolve()));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body, signatureValid: await verifySignature(req, body), closed };
      seen.push(s);
      const a = respond(s);
      if (a.hang) return;
      res.writeHead(a.status ?? 200, a.headers ?? {});
      res.end(a.body);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const run = path.join(home, String(port));
  mkdirSync(run);
  writeFileSync(path.join(run, "ca.pem"), readFileSync(path.join(home, "cert.pem")));
  writeFileSync(path.join(run, "emulator_credentials"), `[default]\naws_access_key_id = ${FAKE_ACCESS_KEY}\naws_secret_access_key = ${FAKE_SECRET}\n`, { mode: 0o600 });
  const config: Config = {
    bindHost: "127.0.0.1",
    port: 9298,
    gatewayPort: 9300,
    emulatorHost: "127.0.0.1",
    emulatorPort: port,
    emulatorTlsServername: "localhost",
    emulatorHome: home,
    webRoot: home,
    modelIndexDir: path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"),
  };
  return {
    config,
    home,
    seen,
    answer: (fn) => {
      respond = fn;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    },
  };
}
