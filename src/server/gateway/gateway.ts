import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";
import { BODY_LIMIT, type GatewayState } from "../../shared/calls.js";
import { recordExchange, type RawExchange } from "../calls/record.js";
import { credentialScope } from "../calls/redact.js";
import type { CallStore } from "../calls/store.js";
import type { Config } from "../config.js";
import { modelIndex, type ModelIndex } from "../model-index/index.js";
import { readCa as readRunCa } from "../sender/run-files.js";
import type { GatewayCertificate } from "./certificate.js";

/** A TLS connection starts with a handshake record (0x16). Every HTTP method starts with a letter. */
export function isTlsHandshake(firstByte: number | undefined): boolean {
  return firstByte === 0x16;
}

/**
 * Whether a request came from a browser page. Browsers add `Origin` to cross-origin and POST requests, and
 * `Sec-Fetch-Site` and `Sec-Fetch-Dest` to every request; page script can't remove them. The AWS SDKs and the CLI
 * send none of them. Node's own `fetch` sends `Sec-Fetch-Mode` alone, so that header says nothing (a Developer's
 * script fetching a presigned URL must work).
 */
export function isFromBrowser(headers: http.IncomingHttpHeaders): boolean {
  return headers.origin !== undefined || headers["sec-fetch-site"] !== undefined || headers["sec-fetch-dest"] !== undefined || headers["sec-fetch-user"] !== undefined;
}

/**
 * Whether a Host names this machine's loopback: an IPv4 127.x.x.x or [::1], `localhost` or `*.localhost` (any port), or
 * a name the Developer allowed with GATEWAY_HOSTS. Anything else is a name some other site pointed at the Gateway
 * (DNS rebinding), and is refused.
 */
export function hostAllowed(host: string | undefined, extra: string[] = []): boolean {
  if (!host) return false;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (name === "[::1]" || name === "localhost" || name.endsWith(".localhost")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)) return true;
  return extra.includes(name);
}

const CA_CACHE_MS = 2000;
/** Headers that describe one connection, not the message. Not forwarded either way. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "upgrade", "te", "trailer"]);
/** TLS alerts a client sends when it does not trust the certificate. */
const UNTRUSTED_ALERT = /unknown ca|bad certificate|certificate unknown|unsupported certificate|certificate expired|certificate revoked/i;
const MAX_CONNECTIONS = 512;

/** The header names a `Connection:` header lists (they are for this hop only). */
function connectionTokens(value: string | string[] | undefined): Set<string> {
  const tokens = new Set<string>();
  for (const v of [value ?? []].flat()) for (const t of v.split(",")) if (t.trim()) tokens.add(t.trim().toLowerCase());
  return tokens;
}

class Capture {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  size = 0;
  push(chunk: Buffer) {
    this.size += chunk.length;
    if (this.kept >= BODY_LIMIT) return;
    const part = chunk.length > BODY_LIMIT - this.kept ? chunk.subarray(0, BODY_LIMIT - this.kept) : chunk;
    this.chunks.push(part);
    this.kept += part.length;
  }
  get buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function pairsOf(raw: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i]!, raw[i + 1]!]);
  return out;
}

/**
 * The answer for a request the Emulator did not answer, written in the shape of the request's protocol so an SDK shows
 * `ServiceUnavailable` and a sentence, not `UnknownError`.
 */
export function unavailableReply(headers: http.IncomingHttpHeaders, message: string): { type: string; body: string; extra: Record<string, string> } {
  const code = "ServiceUnavailable";
  const type = String(headers["content-type"] ?? "").toLowerCase();
  const esc = (s: string) => s.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" })[c]!);
  if (headers["x-amz-target"]) {
    return { type: type.includes("x-amz-json") ? type : "application/x-amz-json-1.0", body: JSON.stringify({ __type: code, message }), extra: { "x-amzn-errortype": code } };
  }
  if (type.startsWith("application/x-www-form-urlencoded")) {
    return { type: "text/xml", body: `<ErrorResponse><Error><Type>Receiver</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error><RequestId>gateway</RequestId></ErrorResponse>`, extra: {} };
  }
  const service = credentialScope(String(headers.authorization ?? ""), undefined).service;
  if (service === "s3" || service === "s3-object-lambda") {
    return { type: "application/xml", body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${esc(message)}</Message><RequestId>gateway</RequestId></Error>`, extra: {} };
  }
  return { type: "application/json", body: JSON.stringify({ message }), extra: { "x-amzn-errortype": code } };
}

export type GatewayDeps = {
  config: Config;
  store: CallStore;
  certificate: GatewayCertificate;
  /** Loads the Service Model index. Defaults to the Console's own. A failure means Calls are recorded unidentified, with bodies withheld. */
  index?: () => Promise<ModelIndex>;
  /** How long a new connection may stay silent before its first byte (ms). Default 10 000. */
  firstByteTimeoutMs?: number;
  /** How long a TLS handshake may take (ms). Default 10 000. */
  handshakeTimeoutMs?: number;
  /** How long the Emulator may be silent before the Gateway gives up on it (ms). Default 30 000. */
  upstreamTimeoutMs?: number;
  /** How long a request's headers may take to arrive (ms). Default 30 000. */
  headersTimeoutMs?: number;
};

/**
 * The Gateway: an HTTP server of its own on `config.gatewayPort` that forwards each request to the Emulator over
 * HTTPS, unchanged and with its original Host (so signatures still verify), and records the Call.
 *
 * One port serves plain HTTP and TLS: a `net.Server` looks at each connection's first byte and hands the socket to the
 * HTTP server, or, wrapped, to TLS and then the same HTTP server.
 *
 * Host and Origin are not access control: anything that can reach the port can send a loopback Host. The Host check
 * stops a name some other site pointed at the Gateway; reaching the port is limited by where it is bound (compose
 * publishes it on 127.0.0.1 only), and nothing here adds credentials to a request.
 */
export class Gateway {
  state: GatewayState = "failed";
  private readonly front: net.Server;
  private readonly http: http.Server;
  private readonly secureContext: tls.SecureContext;
  private readonly sockets = new Set<net.Socket>();
  private readonly agent = new https.Agent({ keepAlive: true, maxSockets: 64 });
  private ca: { text: string; at: number } | null = null;
  private readonly firstByteMs: number;
  private readonly handshakeMs: number;
  private readonly upstreamMs: number;
  private readonly headersMs: number;

  constructor(private readonly deps: GatewayDeps) {
    this.firstByteMs = deps.firstByteTimeoutMs ?? 10_000;
    this.handshakeMs = deps.handshakeTimeoutMs ?? 10_000;
    this.upstreamMs = deps.upstreamTimeoutMs ?? 30_000;
    const headersMs = (this.headersMs = deps.headersTimeoutMs ?? 30_000);
    this.http = http.createServer(
      { requestTimeout: 0, headersTimeout: headersMs, connectionsCheckingInterval: Math.max(100, Math.min(5000, Math.floor(headersMs / 2))) },
      (req, res) => void this.handle(req, res),
    );
    this.secureContext = tls.createSecureContext({ key: deps.certificate.key, cert: deps.certificate.cert, minVersion: "TLSv1.2" });
    this.front = net.createServer((socket) => this.route(socket));
    this.front.maxConnections = MAX_CONNECTIONS;
  }

  /** Starts listening. Resolves with the state: a port in use is a state (B1), not a failure of the Console. */
  listen(): Promise<GatewayState> {
    return new Promise((resolve) => {
      const done = (state: GatewayState) => {
        this.state = state;
        resolve(state);
      };
      this.front.once("error", (err: NodeJS.ErrnoException) => done(err.code === "EADDRINUSE" ? "port-in-use" : "failed"));
      this.front.listen(this.deps.config.gatewayPort, this.deps.config.bindHost, () => {
        this.front.removeAllListeners("error");
        this.front.on("error", () => {});
        done("listening");
      });
    });
  }

  address(): net.AddressInfo | null {
    const a = this.front.address();
    return a && typeof a === "object" ? a : null;
  }

  close(): void {
    this.front.close();
    this.http.close();
    this.agent.destroy();
  }

  closeAllConnections(): void {
    for (const s of this.sockets) s.destroy();
    this.http.closeAllConnections();
  }

  private route(socket: net.Socket) {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
    // A connection that never says anything is dropped.
    socket.setTimeout(this.firstByteMs, () => socket.destroy());
    socket.once("data", (chunk: Buffer) => {
      socket.setTimeout(0);
      if (isTlsHandshake(chunk[0])) return this.secure(socket, chunk);
      socket.pause();
      socket.unshift(chunk); // the HTTP server reads it again
      // Its first request must arrive in full within the time; `handle` lifts this once it has begun.
      socket.setTimeout(this.headersMs, () => socket.destroy());
      this.http.emit("connection", socket);
      socket.resume();
    });
  }

  /**
   * Answers a TLS connection. A `net.Socket` handed to `tls` is read through its native handle, which would lose the
   * byte already read, so the socket is wrapped in a stream that starts with that chunk.
   */
  private secure(socket: net.Socket, first: Buffer) {
    const wrapped = new Duplex({
      read: () => socket.resume(),
      write: (chunk: Buffer, _enc, cb) => void socket.write(chunk, cb),
      final: (cb) => void socket.end(cb),
      destroy: (err, cb) => {
        socket.destroy();
        cb(err);
      },
    });
    socket.on("data", (c: Buffer) => {
      if (!wrapped.push(c)) socket.pause();
    });
    socket.on("end", () => wrapped.push(null));
    socket.on("close", () => wrapped.destroy());
    const secure = new tls.TLSSocket(wrapped, { isServer: true, secureContext: this.secureContext, ALPNProtocols: ["http/1.1"] });
    // A caller that does not trust the certificate abandons the handshake (TLS 1.3 shows the server no error, only a
    // close), so a handshake that ends before it completes, without another error, is counted as a refusal (B4).
    let completed = false;
    let counted = false;
    const count = () => {
      if (counted) return;
      counted = true;
      this.deps.store.countTlsRefusal();
    };
    // A handshake that never finishes is dropped. It is not a refusal: nobody said they distrust anything.
    const stalled = setTimeout(() => {
      if (completed) return;
      counted = true;
      secure.destroy();
      socket.destroy();
    }, this.handshakeMs);
    stalled.unref();
    secure.once("secure", () => {
      completed = true;
      clearTimeout(stalled);
      secure.setTimeout(this.headersMs, () => secure.destroy());
      this.http.emit("connection", secure);
    });
    secure.on("error", (err: NodeJS.ErrnoException & { reason?: string }) => {
      if (!completed && UNTRUSTED_ALERT.test(err.reason ?? err.message)) count();
      else counted = true; // some other failure: not a trust refusal
      secure.destroy();
    });
    secure.on("close", () => {
      clearTimeout(stalled);
      if (!completed) count();
    });
    wrapped.push(first);
  }

  private async loadIndex(): Promise<ModelIndex | null> {
    try {
      return await (this.deps.index ?? (() => modelIndex(this.deps.config.modelIndexDir)))();
    } catch {
      return null;
    }
  }

  /** The run's CA, re-read at most every two seconds: it changes only when the Emulator restarts. */
  private async readCa(): Promise<string | null> {
    if (this.ca && Date.now() - this.ca.at < CA_CACHE_MS) return this.ca.text;
    // The same reader the sender uses: a missing, unsafe or malformed ca.pem is no CA.
    const text = await readRunCa(this.deps.config).catch(() => null);
    this.ca = text === null ? null : { text, at: Date.now() };
    return text;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { config, store } = this.deps;
    req.socket.setTimeout(0);

    if (!hostAllowed(req.headers.host, config.gatewayHosts)) {
      req.resume();
      res.writeHead(421, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Host not allowed. The Gateway answers to localhost and 127.0.0.1; set GATEWAY_HOSTS to allow another name." }));
      return;
    }

    if (isFromBrowser(req.headers)) {
      store.countBrowserRefusal();
      req.resume();
      res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: `The Emulator Console's Gateway records calls from AWS SDKs and refuses requests sent from a browser page. Open the Console at http://127.0.0.1:${config.port}.` }));
      return;
    }

    const startedAt = new Date();
    const requestBody = new Capture();
    const responseBody = new Capture();
    let status = 0;
    let responseHeaders: [string, string][] = [];
    let error: RawExchange["error"];
    let recorded = false;

    const record = () => {
      if (recorded) return;
      recorded = true;
      // The caller left before the answer was complete: nothing was wrong with the Emulator.
      if (!error && !res.writableFinished) error = "client-aborted";
      const raw: RawExchange = {
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        method: req.method ?? "GET",
        url: req.url ?? "/",
        host: req.headers.host,
        requestHeaders: pairsOf(req.rawHeaders),
        requestBody: requestBody.buffer,
        requestSize: requestBody.size,
        status,
        responseHeaders,
        responseBody: responseBody.buffer,
        responseSize: responseBody.size,
        ...(error ? { error } : {}),
      };
      void (async () => {
        try {
          const index = await this.loadIndex();
          store.add(await recordExchange(index, raw, { headersOnly: store.headersOnly, ownNames: config.gatewayHosts }));
        } catch {
          /* a Call that can't be recorded must not affect the next one */
        }
      })();
    };
    res.once("close", record);

    const unavailable = (message: string) => {
      if (res.destroyed) return; // the caller left first: nothing was wrong with the Emulator
      error = "emulator-unreachable";
      if (res.headersSent) return void res.destroy();
      const reply = unavailableReply(req.headers, message);
      res.writeHead(502, { "content-type": reply.type, "cache-control": "no-store", ...reply.extra });
      res.end(reply.body);
    };

    const ca = await this.readCa();
    if (ca === null) {
      req.resume();
      return unavailable("The Gateway couldn't reach the Emulator.");
    }

    const dropped = connectionTokens(req.headers.connection);
    const headers: string[] = [];
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!.toLowerCase();
      // `expect` is answered here (Node already sent 100 Continue); everything else goes on as it came, Host included.
      if (HOP_BY_HOP.has(name) || dropped.has(name) || name === "expect") continue;
      headers.push(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
    }

    const upstream = https.request(
      {
        host: config.emulatorHost,
        port: config.emulatorPort,
        method: req.method,
        path: req.url,
        headers: headers as unknown as http.OutgoingHttpHeaders,
        ca,
        agent: this.agent,
        // An IP address is checked against the certificate's IP names; Node refuses it as a servername.
        ...(config.emulatorTlsServername ? { servername: config.emulatorTlsServername } : {}),
      },
      (up) => {
        status = up.statusCode ?? 0;
        responseHeaders = pairsOf(up.rawHeaders);
        const hop = connectionTokens(up.headers.connection);
        const out: string[] = [];
        for (let i = 0; i + 1 < up.rawHeaders.length; i += 2) {
          const name = up.rawHeaders[i]!.toLowerCase();
          if (HOP_BY_HOP.has(name) || hop.has(name) || name === "transfer-encoding") continue;
          out.push(up.rawHeaders[i]!, up.rawHeaders[i + 1]!);
        }
        try {
          res.writeHead(status, up.statusMessage, out);
        } catch {
          // A header the Emulator sent that Node won't write must not take the Console down.
          up.destroy();
          status = 0;
          return unavailable("The Emulator's answer could not be passed on.");
        }
        up.on("data", (c: Buffer) => responseBody.push(c));
        up.on("error", () => {
          error ??= "emulator-unreachable";
          res.destroy();
        });
        up.on("aborted", () => {
          error ??= "emulator-unreachable";
          res.destroy();
        });
        up.pipe(res);
      },
    );
    upstream.setTimeout(this.upstreamMs, () => upstream.destroy(Object.assign(new Error("The Emulator did not answer in time."), { code: "ETIMEDOUT" })));
    upstream.on("error", (err: NodeJS.ErrnoException) => unavailable(err.code === "ETIMEDOUT" ? "The Emulator didn't answer in time." : "The Gateway couldn't reach the Emulator."));
    req.on("data", (c: Buffer) => requestBody.push(c));
    req.on("error", () => upstream.destroy());
    // The caller went away before the answer: stop asking the Emulator.
    res.once("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  }
}
