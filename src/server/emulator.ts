import { readSmallFile } from "./safefile.js";
import https from "node:https";
import net from "node:net";
import type { EmulatorHealth, EmulatorReason } from "../shared/api.js";
import type { Config } from "./config.js";
import { MAX_CA_BYTES, runFile } from "./sender/run-files.js";

const NOT_LISTENING = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const NOT_TRUSTED = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function reasonFor(err?: NodeJS.ErrnoException): EmulatorReason {
  const code = err?.code ?? "";
  if (NOT_LISTENING.has(code)) return "refused";
  if (NOT_TRUSTED.has(code)) return "untrusted";
  return "unreachable";
}

/** Whether something accepts a TCP connection at the Emulator's address. No request is sent. */
export function isListening(config: Config): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: config.emulatorHost, port: config.emulatorPort, timeout: 3000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Asks the Emulator's `GET /__admin/health` over HTTPS, trusting only this run's `ca.pem`. Not an AWS call. */
export async function checkEmulatorHealth(config: Config): Promise<EmulatorHealth> {
  const port = config.emulatorPort;
  const ca = await readSmallFile(runFile(config, "ca.pem"), MAX_CA_BYTES);
  if (ca === null) {
    // Without ca.pem (or with anything but a small regular file) nothing can be trusted, but whether anything
    // is listening can still be said.
    return { reachable: false, port, reason: (await isListening(config)) ? "no-ca" : "refused" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (health: EmulatorHealth) => {
      if (settled) return;
      settled = true;
      resolve(health);
    };
    const fail = (err?: NodeJS.ErrnoException) => settle({ reachable: false, port, reason: reasonFor(err) });
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
        res.on("error", (err) => fail(err));
        res.on("aborted", () => fail());
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
    req.on("error", (err) => fail(err));
    req.end();
  });
}
