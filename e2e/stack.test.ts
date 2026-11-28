import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The shared e2e stack (scripts/e2e.sh up): Emulator on 19297, Console on 19298.
const CONSOLE_PORT = 19298;
const EMULATOR_PORT = 19297;
const RUN_DIR = path.resolve(import.meta.dirname, "..", ".aws", "e2e", String(EMULATOR_PORT));

function get(urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: CONSOLE_PORT, path: urlPath, headers: { host: `127.0.0.1:${CONSOLE_PORT}`, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("console-e2e stack", () => {
  it("the Console reaches the Emulator's health route over HTTPS with ca.pem", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ emulator: { reachable: true, port: EMULATOR_PORT } });
  });

  it("the image ships the Service Model index", async () => {
    const res = await get("/api/services");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { meta: { emulator: { version: string } }; services: unknown[] };
    expect(body.services).toHaveLength(436);
    expect(body.meta.emulator.version).toBe("1.0.509");
    expect((await get("/api/service?sdkId=DynamoDB")).status).toBe(200);
  });

  it("serves the shell page", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Emulator Console");
  });

  it("refuses a foreign Host and a foreign Origin", async () => {
    expect((await get("/api/health", { host: "evil.example" })).status).toBe(421);
    expect((await get("/api/health", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("never sends the Emulator's key or secret", async () => {
    const credentials = readFileSync(path.join(RUN_DIR, "emulator_credentials"), "utf8");
    const values = [...credentials.matchAll(/=\s*(\S+)/g)].map((m) => m[1]!);
    expect(values.length).toBeGreaterThanOrEqual(2);
    const page = await get("/");
    const assets = [...page.body.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]!);
    for (const p of ["/", "/api/health", ...assets]) {
      const res = await get(p);
      // Compare as booleans so a failure never prints the secret.
      for (const v of values) expect(res.body.includes(v), `${p} leaked a credential value`).toBe(false);
    }
  });

  it("publishes the run's files where the Console reads them", () => {
    expect(readdirSync(RUN_DIR)).toEqual(expect.arrayContaining(["ca.pem", "emulator_credentials"]));
  });
});
