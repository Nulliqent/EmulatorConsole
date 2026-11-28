// Types for the Calls and Gateway API, imported by both the server and the UI.

/** The most Calls kept. Older ones are removed as new ones arrive (state C2). */
export const CALL_LIMIT = 5000;
/** The most bytes of one body kept (state C4). */
export const BODY_LIMIT = 256 * 1024;
/** What a masked value is replaced with in a recorded Call (state C6). */
export const HIDDEN = "Hidden";
/** What a value that is never kept (a signature, a session token) is replaced with. It cannot be shown. */
export const NOT_KEPT = "Not kept";
/**
 * The most memory the stored Calls may use, in bytes (UTF-8): bodies (text and kept binary), headers, paths and what
 * "Show" needs. Past it the oldest Calls lose their bodies and keep their summaries and headers. 5,000 Calls of 256 KB,
 * twice over, don't fit the 512 MB container.
 */
export const BODY_BYTE_BUDGET = 200 * 1024 * 1024;

/**
 * What became of a body.
 * - `text`: kept (up to BODY_LIMIT bytes; `truncated` says whether it was cut). `size` is the original size.
 * - `binary`: binary or compressed, so not shown (C5). `base64` holds the bytes (up to 256 KB) when they could be checked
 *   for sensitive values, so the Developer can copy them; otherwise there are no bytes.
 * - `not-recorded`: the "Record headers and status only" setting was on (B3).
 * - `withheld`: could not be checked for sensitive values (cut at the limit, unreadable, or the operation is unknown),
 *   so none of it is shown. "Show" returns it.
 * - `removed`: dropped to stay within the memory budget; the Call's summary and headers remain.
 * - `none`: the message had no body.
 */
export type BodyKind = "text" | "binary" | "not-recorded" | "withheld" | "removed" | "none";

export type CallBody = {
  kind: BodyKind;
  /** Size of the whole body on the wire, in bytes. */
  size: number;
  /** The kept text, with sensitive values replaced by "Hidden". Only for kind "text". */
  text?: string;
  /** True when `text` is only the first BODY_LIMIT bytes. */
  truncated?: boolean;
  contentType?: string;
  /** Content-Encoding, when the body is compressed or otherwise encoded. */
  encoding?: string;
  /** The bytes of a binary body, base64, for "Copy as base64" (C5). Only when nothing in them can be sensitive. */
  base64?: string;
};

export type CallMessage = {
  /** Header names are as sent; Authorization has its signature removed and X-Amz-Security-Token is not kept. */
  headers: [string, string][];
  body: CallBody;
};

/** A Call in the list: everything but headers and bodies. */
export type CallSummary = {
  /**
   * Increases with each recorded Call; unique within the Console process. Ids follow the order Calls were *recorded*
   * (when the response ended), not the order they started, so a slow Call can have a higher id than a later-started
   * one. `after=<id>` reads what was recorded since, which is exactly what a cursor needs; sort by `startedAt` to order
   * by start.
   */
  id: number;
  /** The Emulator Run the Call belongs to (1 for the first one the Console saw). */
  run: number;
  startedAt: string;
  durationMs: number;
  method: string;
  /** The URL path, with sensitive path values hidden. */
  path: string;
  /** The query string without the leading "?", with signatures removed and sensitive values hidden. "" if none. */
  query: string;
  service?: { sdkId: string; slug: string };
  operation?: string;
  /** From the request's signing scope. */
  region?: string;
  /** The response status, or 0 when the Emulator did not answer. */
  status: number;
  /**
   * `emulator-unreachable`: the Gateway got no answer from the Emulator (down, reset, or silent for 30 s).
   * `client-aborted`: the caller went away first; nothing was wrong with the Emulator.
   */
  error?: "emulator-unreachable" | "client-aborted";
  /** For a failed response: the error code on the wire (`NotImplemented`, `ResourceNotFoundException`), without a namespace. */
  errorCode?: string;
  /** For a failed response of an identified operation: whether its model declares that error. */
  declared?: boolean;
  /** For a failed response: whether it is an Emulator Gap by the rule in decisions.md (501, UnknownService, InvalidAction for a modelled operation). */
  emulatorGap?: boolean;
  /** How many values are hidden in this Call. POST /api/calls/reveal returns them when this is above 0. */
  hidden: number;
};

/** One Call with its headers and bodies. */
export type CallDetail = CallSummary & { request: CallMessage; response: CallMessage };

/** One Emulator Run as seen by the Gateway. */
export type CallRun = { id: number; startedAt: string };

/** GET /api/calls?limit=&before=&after=&run= : newest first. */
export type CallsResponse = {
  calls: CallSummary[];
  /** Calls held now (at most CALL_LIMIT). */
  total: number;
  /** The id of the latest Call recorded since the Console started, or 0. Use `after=` with it to read what is new. */
  lastId: number;
  /** True once a Call has been removed, or a Call's bodies have been dropped, to stay within CALL_LIMIT or the memory budget (C2). */
  limitReached: boolean;
  runs: CallRun[];
  /** Whether more Calls match, further back. */
  more: boolean;
};

/** GET /api/calls/get?id= */
export type CallResponse = { call: CallDetail };

/** POST /api/calls/reveal {id}: the same Call with nothing hidden. Only this route sends hidden values. */
export type RevealResponse = { call: CallDetail };

/** POST /api/calls/clear */
export type ClearResponse = { cleared: number };

export type GatewayState = "listening" | "port-in-use" | "failed";

export type GatewayCount = { count: number; lastAt: string | null };

/** GET /api/gateway */
export type GatewayStatus = {
  state: GatewayState;
  port: number;
  /** The line a Developer puts in their SDK's environment, such as "http://127.0.0.1:9300". */
  endpoint: string;
  /** The "Record headers and status only" setting (B3). */
  headersOnly: boolean;
  /** Calls held, and the id of the latest. */
  total: number;
  lastId: number;
  /** The first Call of the current Emulator Run, for "First Call recorded: …" (even if it has since been removed). */
  firstCall: { id: number; operation?: string; method: string; path: string; startedAt: string } | null;
  /** Requests refused because a browser sent them (B2). Reset when an Emulator Run ends. */
  refusedFromBrowser: GatewayCount;
  /** TLS connections refused because the caller did not trust the Gateway's certificate (B4). */
  tlsRefused: GatewayCount;
  /** Where the Gateway's certificate can be read, for SDKs that follow an https URL back to the Gateway. */
  certificatePath: string;
};

/** POST /api/gateway/settings */
export type GatewaySettingsRequest = { headersOnly: boolean };
