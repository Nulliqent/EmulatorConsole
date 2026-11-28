import * as serde from "@smithy/core/serde";
import { HttpRequest } from "@smithy/core/transport";
import { SignatureV4 } from "@smithy/signature-v4";
import type { RefusedReason, SendOutcome, SendRequest, ValidationProblem } from "../../shared/send.js";
import type { Config } from "../config.js";
import { isListening } from "../emulator.js";
import type { ModelIndex } from "../model-index/index.js";
import { readAnswer } from "./answer.js";
import { RunFileError, readCa, readCredentials } from "./run-files.js";
import { compileService } from "./schema.js";
import { scrubString, secretsOf } from "./scrub.js";
import { SEND_TIMEOUT_MS, TransportError, transmit } from "./transport.js";
import { toSdkInput, validateInput } from "./values.js";

/** The Console refuses the request itself. The route turns it into a `SendRefused` with this HTTP status. */
export class BadSendRequest extends Error {
  constructor(readonly status: 400 | 404 | 422, readonly reason: RefusedReason, message: string, readonly eventStream = false) {
    super(message);
    this.name = "BadSendRequest";
  }
}

const REGION = /^[a-z0-9][a-z0-9-]{0,30}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

export type SendOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Sends one operation to the Emulator: validates the input, serializes it with the AWS SDK's protocol class for the
 * service, signs it with the run's keys (read here, never returned), sends it over HTTPS trusting the run's `ca.pem`,
 * and parses the answer (see `readAnswer`). An answer the model cannot read comes back raw and flagged.
 */
export async function sendOperation(config: Config, index: ModelIndex, request: SendRequest, options: SendOptions = {}): Promise<SendOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;

  const summary = index.service(request.sdkId);
  const detail = summary && (await index.detail(summary.sdkId));
  if (!summary || !detail) throw new BadSendRequest(404, "unknown-service", `The Console has no service "${request.sdkId.slice(0, 100)}".`);
  const op = detail.operations.find((o) => o.name === request.operation);
  if (!op) throw new BadSendRequest(404, "unknown-operation", `${summary.sdkId} has no operation "${request.operation.slice(0, 100)}".`);
  if (!REGION.test(request.region)) throw new BadSendRequest(400, "invalid-region", "The Region is not valid.");

  const compiled = compileService(detail, summary);
  if (compiled.hasEventStream(op.name)) {
    throw new BadSendRequest(422, "event-stream", "Event streams can't be sent from the Console.", true);
  }

  const problems = validateInput(detail.shapes, op.input, request.input);
  if (problems.length && !request.sendInvalid) return { kind: "invalid", problems };

  const noResponse = (reason: "no-ca" | "no-credentials" | "unreachable" | "timeout" | "cancelled", message: string, mayHaveArrived = false): SendOutcome => ({
    kind: "no-response", reason, message, mayHaveArrived, problems, elapsedMs: elapsed(),
  });

  let credentials: Awaited<ReturnType<typeof readCredentials>>;
  let ca: string;
  try {
    ca = await readCa(config);
    credentials = await readCredentials(config);
  } catch (e) {
    if (!(e instanceof RunFileError)) throw e;
    if (e.file === "ca.pem") {
      // With nothing listening the Emulator is simply not running; a running one without ca.pem cannot be trusted.
      return (await isListening(config))
        ? noResponse("no-ca", "The Emulator's ca.pem is not readable, so the Console cannot trust it.")
        : noResponse("unreachable", "The Emulator isn't answering.");
    }
    return noResponse("no-credentials", "The Emulator's credentials are not readable.");
  }
  const secrets = secretsOf(credentials);
  const invalid = (extra: ValidationProblem[]): SendOutcome => ({ kind: "invalid", problems: [...problems, ...extra] });

  const schema = compiled.operation(op.name);
  const protocol = compiled.createProtocol();
  const hostHeader = `${config.emulatorHost}:${config.emulatorPort}`;
  const display = config.emulatorDisplayAddress ?? hostHeader;
  const context = compiled.createContext(op.name, { hostname: config.emulatorHost, port: config.emulatorPort });
  protocol.setSerdeContext(context);

  // Serialize and sign.
  let wire: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array; host: string };
  let shownUrl: string;
  try {
    const sdkInput = toSdkInput(detail.shapes, op.input, request.input);
    const built = (await protocol.serializeRequest(schema, sdkInput, context)) as HttpRequest;
    const body =
      built.body == null || built.body === ""
        ? undefined
        : typeof built.body === "string"
          ? Buffer.from(built.body)
          : (() => {
              const b = built.body as Uint8Array;
              return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
            })();
    const headers: Record<string, string> = { ...built.headers, host: hostHeader };
    // A declared length with nothing to send would make the Emulator wait for bytes that never come.
    if (!body) delete headers["content-length"];

    // Node writes header values as Latin-1 but SigV4 signs them as UTF-8, and a line break would split the request, so
    // a value outside printable ASCII can never be sent and signed correctly. The AWS SDK leaves this to the caller.
    const badHeaders: ValidationProblem[] = [];
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME.test(name)) badHeaders.push({ path: name, rule: "header", message: `"${name.slice(0, 60)}" is not a valid header name.` });
      else if (!HEADER_VALUE.test(String(value))) {
        badHeaders.push({ path: name, rule: "header", message: `The value of ${name} has characters other than printable ASCII, which a header cannot carry (S3 metadata must be ASCII).` });
      }
    }
    if (badHeaders.length) return invalid(badHeaders);

    let path = built.path;
    shownUrl = `https://${display}`;
    if (summary.sdkId === "S3" && request.s3Addressing === "virtual-host") {
      // The bucket moves from the first path segment to the first label of the Host. The connection still goes to the
      // Emulator, and its certificate is checked against `servername` (localhost), not against this name.
      const m = /^\/([^/?]+)(\/.*)?$/.exec(path);
      if (m && BUCKET.test(m[1]!)) {
        path = m[2] ?? "/";
        headers.host = `${m[1]}.s3.${request.region}.amazonaws.com:${config.emulatorPort}`;
        shownUrl = `https://${headers.host}`;
      }
    }
    const signer = new SignatureV4({
      service: compiled.signingName,
      region: request.region,
      credentials,
      sha256: serde.Hash.bind(null, "sha256") as never,
      uriEscapePath: compiled.signingName !== "s3",
      applyChecksum: true,
    });
    const signed = (await signer.sign(
      new HttpRequest({ method: built.method, protocol: "https:", hostname: headers.host.split(":")[0]!, port: config.emulatorPort, path, query: built.query, headers, body }),
    )) as HttpRequest;
    wire = { method: signed.method, path: withQuery(signed.path, signed.query), headers: signed.headers, body, host: headers.host };
    shownUrl += wire.path;
  } catch (e) {
    // Input that breaks the model can fail to serialize; that is the input's problem, shown with the others.
    const message = scrubString(e instanceof Error ? e.message : "unknown error", secrets);
    return invalid([{ path: "", rule: "type", message: `The input could not be serialized: ${message}` }]);
  }

  let answer;
  try {
    answer = await transmit(
      { host: config.emulatorHost, port: config.emulatorPort, ca, servername: config.emulatorTlsServername ?? (wire.host !== hostHeader ? "localhost" : undefined) },
      wire,
      { signal: options.signal, timeoutMs },
    );
  } catch (e) {
    if (!(e instanceof TransportError)) throw e;
    const maybe = e.mayHaveArrived ? " The request may have reached the Emulator." : "";
    if (e.reason === "timeout") return noResponse("timeout", `No response after ${Math.round(timeoutMs / 1000)} s.${maybe}`, e.mayHaveArrived);
    if (e.reason === "cancelled") return noResponse("cancelled", `Cancelled.${maybe}`, e.mayHaveArrived);
    return noResponse("unreachable", `The Emulator did not answer.${maybe}`, e.mayHaveArrived);
  }

  return {
    kind: "response",
    ...(await readAnswer(compiled, detail, op.name, answer, secrets)),
    problems,
    request: { method: wire.method, url: scrubString(shownUrl, secrets), region: request.region },
    elapsedMs: elapsed(),
  };
}

/** `path` plus its query, encoded the way SigV4 signs it. */
function withQuery(path: string, query: Record<string, string | string[] | null> | undefined): string {
  if (!query) return path;
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) parts.push(enc(k));
    else for (const item of Array.isArray(v) ? v : [v]) parts.push(`${enc(k)}=${enc(item)}`);
  }
  return parts.length ? `${path}?${parts.join("&")}` : path;
}
