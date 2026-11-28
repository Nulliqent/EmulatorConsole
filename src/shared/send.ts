// Types for sending an operation to the Emulator, imported by both the server and the UI. Types only, no runtime code.

/**
 * POST /api/send
 *
 * The answer is one of: a `SendOutcome` (HTTP 200: the Emulator answered, did not answer, or the input was held back),
 * or a `SendRefused` (HTTP 4xx/5xx: the Console itself said no, before anything was sent). Tell them apart by `kind`.
 */
export type SendRequest = {
  /** The service's SDK ID ("Secrets Manager") or slug. */
  sdkId: string;
  operation: string;
  region: string;
  /**
   * The operation's input as JSON. Conversion follows the model's type of each member:
   * - blob: a base64 string, or `{ "text": "..." }` for UTF-8 text;
   * - timestamp: an ISO 8601 string or epoch seconds. A member the model types as a string (such as S3's `Expires`)
   *   is sent exactly as written, never converted;
   * - long and bigInteger: a number, or a string of digits. A string beyond the safe integer range is sent exactly.
   * Omitted means an empty input.
   */
  input?: unknown;
  /** Send even when the input breaks the model (state E7). Default false: the problems come back and nothing is sent. */
  sendInvalid?: boolean;
  /** S3 only: put the bucket in the Host (`<bucket>.s3.<region>.amazonaws.com`) instead of the path. */
  s3Addressing?: "path" | "virtual-host";
};

export type ValidationRule = "required" | "unknown-member" | "type" | "length" | "range" | "pattern" | "enum" | "header";

/** One way the input breaks the model. `path` is `Member.Child[0].Key` style, empty for the whole input. */
export type ValidationProblem = { path: string; rule: ValidationRule; message: string };

/**
 * The Emulator's answer as bytes, cut at 256 KB (state E6).
 * `size` is the whole body's size in bytes. When the answer was so large the Console stopped reading it
 * (`SendResponse.tooLarge`), `size` is only what was read before stopping and `sizeIsMinimum` is true: show "at least N".
 */
export type RawBody = {
  /** UTF-8 text, or base64 when the bytes are not text. */
  body: string;
  encoding: "utf8" | "base64";
  size: number;
  sizeIsMinimum: boolean;
  truncated: boolean;
};

export type SendError = {
  /** The error's name as the model knows it, or the wire code when the model does not. */
  name: string;
  message: string;
  /** Whether the operation's model (or its service's common errors) declares this error. */
  declared: boolean;
  /** The error's modelled members, when it has any. */
  details?: unknown;
};

/**
 * A blob or stream member of `output` that was cut. Every blob in `output` is base64 text of at most 256 KB of bytes;
 * a longer one keeps its first 256 KB, and is listed here with its path and original size in bytes.
 */
export type TruncatedMember = { path: string; size: number };

/** The Emulator answered. */
export type SendResponse = {
  kind: "response";
  status: number;
  headers: Record<string, string>;
  /** The parsed output of a success. Blobs are base64; 64-bit integers beyond the safe range are strings. */
  output?: unknown;
  /** Blob members of `output` that were cut at 256 KB. */
  truncatedMembers?: TruncatedMember[];
  /** The parsed error of a failure. */
  error?: SendError;
  /** The Emulator does not do this: 501 NotImplemented, UnknownService (404), InvalidAction for a modelled operation. */
  emulatorGap: boolean;
  /** The answer could not be read with the model (state C7). `raw` holds what came back. */
  unreadable: boolean;
  /** The answer was too large to read, so it was not parsed. Not the same as unreadable: nothing is wrong with it. */
  tooLarge: boolean;
  raw: RawBody;
  /** Problems found in the input. Non-empty only when the Developer chose to send invalid input. */
  problems: ValidationProblem[];
  /** The request as sent, at the address a Developer reaches the Emulator by. Never carries credentials. */
  request: { method: string; url: string; region: string };
  elapsedMs: number;
};

export type NoResponseReason = "timeout" | "cancelled" | "unreachable" | "no-ca" | "no-credentials";

/** No answer came back (state E2 and the connection states). */
export type SendNoResponse = {
  kind: "no-response";
  reason: NoResponseReason;
  message: string;
  /** The request may have reached the Emulator before this happened. */
  mayHaveArrived: boolean;
  problems: ValidationProblem[];
  elapsedMs: number;
};

/** The input breaks the model and `sendInvalid` was not set, or cannot be serialized: nothing was sent. */
export type SendInvalid = { kind: "invalid"; problems: ValidationProblem[] };

export type SendOutcome = SendResponse | SendNoResponse | SendInvalid;

export type RefusedReason =
  | "host-not-allowed"
  | "forbidden"
  | "method-not-allowed"
  | "bad-json"
  | "bad-request"
  | "too-large"
  | "unknown-service"
  | "unknown-operation"
  | "invalid-region"
  | "event-stream"
  | "busy";

/**
 * The Console refused the request itself; nothing was sent to the Emulator. This is never an Emulator's answer, even
 * for "unknown service": the Emulator's own UnknownService arrives as a `SendResponse` with `error.name`.
 * `eventStream` is true for an operation with an event stream (state E4), which the Console cannot send: disable Send.
 */
export type SendRefused = { kind: "refused"; reason: RefusedReason; message: string; eventStream?: true };
