import type http from "node:http";
import https from "node:https";
import type { NoResponseReason } from "../../shared/send.js";

/** The overall time a send may take, from the first byte written to the last byte read (state E2). */
export const SEND_TIMEOUT_MS = 30_000;
/** The most response bytes kept in memory. A larger answer is not read to its end: the connection is closed. */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class TransportError extends Error {
  constructor(readonly reason: Exclude<NoResponseReason, "no-ca" | "no-credentials">, readonly mayHaveArrived: boolean) {
    super(reason);
    this.name = "TransportError";
  }
}

export type WireRequest = {
  method: string;
  /** Path with its query string. */
  path: string;
  headers: Record<string, string>;
  body?: Uint8Array;
};

export type WireResponse = {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  /** The answer was longer than the limit; `body` holds the first bytes and the connection was closed. */
  tooLarge: boolean;
  /** The size the answer had; when `tooLarge`, only the bytes read before the Console stopped. */
  size: number;
};

export type Target = { host: string; port: number; ca: string; servername?: string };

/**
 * One HTTPS request to the Emulator, trusting only `ca`. The time limit covers the whole exchange. `signal` cancels it.
 * The Host header comes from `request.headers`: signatures cover it, so it is never rewritten here.
 */
export function transmit(
  target: Target,
  request: WireRequest,
  { signal, timeoutMs = SEND_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES }: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {},
): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let written = false;
    let req: http.ClientRequest | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const fail = (reason: TransportError["reason"]) => {
      req?.destroy();
      finish(() => reject(new TransportError(reason, written)));
    };
    const onAbort = () => fail("cancelled");
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
    if (signal?.aborted) return fail("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      req = https.request({
        host: target.host,
        port: target.port,
        method: request.method,
        path: request.path,
        headers: request.headers,
        ca: target.ca,
        // An IP address is checked against the certificate's IP names; Node refuses it as a servername.
        ...(target.servername ? { servername: target.servername } : {}),
        agent: false,
      });
      req.on("socket", (socket) => {
        if (socket.connecting) socket.once("secureConnect", () => (written = true));
        else written = true;
      });
      req.on("error", () => fail("unreachable"));
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        let kept = 0;
        let seen = 0;
        const headers = () => {
          const out: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out[k] = v;
          return out;
        };
        res.on("data", (chunk: Buffer) => {
          seen += chunk.length;
          if (kept < maxBytes) {
            const piece = chunk.subarray(0, maxBytes - kept);
            chunks.push(piece);
            kept += piece.length;
          }
          if (seen > maxBytes) {
            // Too large to use: stop here and close the connection, instead of reading the rest until the timeout.
            const answer: WireResponse = { status: res.statusCode ?? 0, headers: headers(), body: Buffer.concat(chunks), tooLarge: true, size: seen };
            finish(() => resolve(answer));
            req?.destroy();
          }
        });
        res.on("error", () => fail("unreachable"));
        res.on("aborted", () => fail("unreachable"));
        res.on("end", () => {
          const answer: WireResponse = { status: res.statusCode ?? 0, headers: headers(), body: Buffer.concat(chunks), tooLarge: false, size: seen };
          finish(() => resolve(answer));
        });
      });
      req.end(request.body ? Buffer.from(request.body.buffer, request.body.byteOffset, request.body.byteLength) : undefined);
    } catch {
      // Node refuses a header it cannot send; callers check header values first, this is the backstop.
      fail("unreachable");
    }
  });
}
