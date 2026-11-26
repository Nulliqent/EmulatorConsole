import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import type { EmulatorHealth } from "../shared/api.js";
import type { Config } from "./config.js";

function runFile(config: Config, name: string): string {
  return path.join(config.emulatorHome, String(config.emulatorPort), name);
}

/** Asks the Emulator's `GET /__admin/health` over HTTPS, trusting only this run's `ca.pem`. Not an AWS call. */
export async function checkEmulatorHealth(config: Config): Promise<EmulatorHealth> {
  const port = config.emulatorPort;
  let ca: string;
  try {
    ca = await readFile(runFile(config, "ca.pem"), "utf8");
  } catch {
    return { reachable: false, port, reason: "no-ca" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (health: EmulatorHealth) => {
      if (settled) return;
      settled = true;
      resolve(health);
    };
    const fail = () => settle({ reachable: false, port, reason: "unreachable" });
    const req = https.request(
      {
        host: config.emulatorHost,
        port,
        path: "/__admin/health",
        method: "GET",
        ca,
        // An IP address is checked against the certificate's IP names; Node refuses it as a servername.
        ...(config.emulatorTlsServername ? { servername: config.emulatorTlsServername } : {}),
        timeout: 3000,
      },
      (res) => {
        res.on("error", fail);
        res.on("aborted", fail);
        res.on("close", () => {
          if (!res.complete) fail();
        });
        res.on("end", () =>
          settle(
            res.statusCode === 200
              ? { reachable: true, port }
              : { reachable: false, port, reason: "unhealthy" },
          ),
        );
        res.resume();
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", fail);
    req.end();
  });
}
