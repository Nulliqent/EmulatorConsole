import { type CallBody, type CallDetail } from "../../shared/calls.js";
import type { ModelIndex } from "../model-index/index.js";
import { declaredErrorNames, isDeclaredError, isEmulatorGap, wireErrorCode } from "../sender/classify.js";
import { identify, knownService, type Identified } from "./identify.js";
import { directionHasSensitive, maskRequest, maskResponse, type MaskContext } from "./mask.js";
import { credentialScope, formatQuery, hideKeyHeaders, looksSecret, parseQuery, redactHeaders, redactQuery, stripSecretValues } from "./redact.js";
import type { Replacement } from "./scan.js";
import type { NewCall, Restore } from "./store.js";

/** One request and response as the Gateway saw them, before anything is masked. */
export type RawExchange = {
  startedAt: Date;
  durationMs: number;
  method: string;
  /** The request target as sent: path and query string. */
  url: string;
  host?: string;
  /** Header names as sent. */
  requestHeaders: [string, string][];
  /** The first BODY_LIMIT bytes of the request body, and its whole size. */
  requestBody: Buffer;
  requestSize: number;
  /** 0 when the Emulator did not answer. */
  status: number;
  responseHeaders: [string, string][];
  responseBody: Buffer;
  responseSize: number;
  error?: "emulator-unreachable" | "client-aborted";
};

export type RecordOptions = {
  headersOnly: boolean;
  /** Names the Gateway answers to besides localhost (`GATEWAY_HOSTS`); they can carry an S3 bucket as the first label. */
  ownNames?: string[];
};

type Classified = { body: CallBody; complete: boolean; buf: Buffer };

const header = (headers: [string, string][], name: string) => headers.find(([n]) => n.toLowerCase() === name)?.[1];

/** Decides whether a captured body is text (kept) or binary or encoded (not shown: C5), and cuts it at the limit (C4). */
export function classifyBody(buf: Buffer, size: number, headers: [string, string][]): Classified {
  const contentType = header(headers, "content-type");
  const encoding = header(headers, "content-encoding")?.toLowerCase();
  const base = { size, ...(contentType ? { contentType } : {}) };
  if (size === 0) return { body: { kind: "none", size: 0 }, complete: true, buf };
  if (encoding && encoding !== "identity") return { body: { ...base, kind: "binary", encoding }, complete: false, buf };
  const complete = buf.length >= size;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: complete }).decode(buf);
  } catch {
    return { body: { ...base, kind: "binary" }, complete, buf };
  }
  if (!complete) text = text.replace(/�$/, ""); // a character cut by the limit
  let odd = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return { body: { ...base, kind: "binary" }, complete, buf };
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) odd++;
  }
  if (odd > 0 && odd / text.length > 0.01) return { body: { ...base, kind: "binary" }, complete, buf };
  return { body: { ...base, kind: "text", text: stripSecretValues(text), ...(complete ? {} : { truncated: true }) }, complete, buf };
}

function toObject(headers: [string, string][]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [n, v] of headers) out[n.toLowerCase()] = out[n.toLowerCase()] === undefined ? v : `${out[n.toLowerCase()]}, ${v}`;
  return out;
}

function splitUrl(url: string): { path: string; query: string } {
  const q = url.indexOf("?");
  return q === -1 ? { path: url, query: "" } : { path: url.slice(0, q), query: url.slice(q + 1) };
}

const changed = (before: [string, string][], after: [string, string][]): [number, string][] =>
  before.flatMap(([, v], i): [number, string][] => (after[i] && after[i]![1] !== v ? [[i, v]] : []));

type Side = { body: CallBody; shown: string | null; restore: Replacement[]; withheldText?: string };

/**
 * Builds the Call to store: identifies it, removes signatures and tokens, hides sensitive values, and keeps what "Show"
 * needs (the original text of what was hidden) aside. Nothing is shown that could not be checked: a body that is cut,
 * unreadable, or of an operation the Console could not identify under a service it knows, is withheld. With "headers and
 * status only" on, no body is kept.
 */
export async function recordExchange(index: ModelIndex | null, raw: RawExchange, options: RecordOptions): Promise<NewCall> {
  const { path, query } = splitUrl(raw.url);
  const pairs = parseQuery(query);
  const reqHeaders = toObject(raw.requestHeaders);
  const resHeaders = toObject(raw.responseHeaders) as Record<string, string>;
  const scope = credentialScope(reqHeaders["authorization"], pairs.find(([k]) => k.toLowerCase() === "x-amz-credential")?.[1]);

  const req = classifyBody(raw.requestBody, raw.requestSize, raw.requestHeaders);
  const res = classifyBody(raw.responseBody, raw.responseSize, raw.responseHeaders);

  // Signatures and tokens go first; everything after works on what is left.
  const keptHeaders = redactHeaders(raw.requestHeaders);
  const keptQuery = redactQuery(pairs);
  const keptResponseHeaders = redactHeaders(raw.responseHeaders);

  let found: Identified | undefined;
  let failClosed = index === null; // no model: nothing can be checked
  if (index) {
    try {
      found = await identify(
        index,
        { method: raw.method, path, query: pairs, headers: reqHeaders, body: req.body.kind === "text" ? (req.body.text ?? "") : "", signingName: scope.service },
        raw.host,
        options.ownNames,
      );
      // Nothing matched: signed for a service the index has, or not signed at all (so nothing says what it is). Either may
      // carry sensitive members, so no body is shown. A Call signed for a service the index has never heard of is not
      // one the Console can speak for, and is shown as sent.
      if (!found && (knownService(index, scope.service) || !scope.service)) failClosed = true;
    } catch {
      failClosed = true;
    }
  }

  // The failure's own words, read before anything is hidden: the code is never sensitive.
  let errorCode: string | undefined;
  let declared: boolean | undefined;
  let emulatorGap: boolean | undefined;
  if (raw.status >= 400 || resHeaders["x-amzn-errortype"]) {
    errorCode = wireErrorCode(resHeaders, res.body.text ?? "");
    emulatorGap = isEmulatorGap(raw.status, [errorCode], { modelled: found !== undefined });
    if (found && errorCode) declared = isDeclaredError(declaredErrorNames(found.detail, found.op.name), errorCode);
  }

  let hidden = 0;
  let maskedPath = path;
  let maskedQuery = keptQuery;
  let reqMasked: { headers: [string, string][]; body: string | null; restore: Replacement[] } = { headers: keptHeaders, body: req.body.text ?? null, restore: [] };
  let resMasked: { headers: [string, string][]; body: string | null; restore: Replacement[] } = { headers: keptResponseHeaders, body: res.body.text ?? null, restore: [] };
  let ctx: MaskContext | undefined;
  if (found) {
    ctx = { shapes: found.detail.shapes, protocol: found.wire, commonErrors: found.detail.commonErrors, op: found.op };
    const r = maskRequest(ctx, {
      path,
      query: keptQuery,
      headers: keptHeaders,
      body: req.body.kind === "text" ? req.body.text : undefined,
      bodyComplete: req.complete,
      pathPrefix: found.pathPrefix,
    });
    maskedPath = r.path;
    maskedQuery = r.query;
    reqMasked = { headers: r.headers, body: r.body, restore: r.bodyRestore };
    hidden += r.hidden;
    const s = maskResponse(ctx, {
      status: raw.status,
      headers: keptResponseHeaders,
      body: res.body.kind === "text" ? res.body.text : undefined,
      bodyComplete: res.complete,
    });
    resMasked = { headers: s.headers, body: s.body, restore: s.bodyRestore };
    hidden += s.hidden;
  }
  // By name, for any Call: a customer-provided encryption key is never shown, identified or not.
  const afterKeys = hideKeyHeaders(reqMasked.headers);
  hidden += changed(reqMasked.headers, afterKeys).length;
  reqMasked.headers = afterKeys;

  const typed = (body: CallBody) => ({ ...(body.contentType ? { contentType: body.contentType } : {}) });
  const sideOf = (c: Classified, masked: { body: string | null; restore: Replacement[] }, direction: "request" | "response"): Side => {
    const body = c.body;
    if (options.headersOnly && body.kind !== "none") return { body: { kind: "not-recorded", size: body.size, ...typed(body) }, shown: null, restore: [] };
    if (body.kind === "text") {
      if (failClosed || masked.body === null) {
        hidden++;
        return { body: { kind: "withheld", size: body.size, ...typed(body) }, shown: null, restore: [], withheldText: body.text };
      }
      return { body: { ...body, text: masked.body }, shown: masked.body, restore: masked.restore };
    }
    if (body.kind === "binary") {
      // The bytes are kept for "Copy as base64" only when they could be checked: an identified operation with nothing
      // sensitive in this direction, no content encoding at all (gzip and aws-chunked can't be read, and aws-chunked
      // carries signatures), and no sign of a signature or session token in them.
      const safe = ctx !== undefined && !failClosed && !directionHasSensitive(ctx, direction) && !body.encoding && !looksSecret(c.buf);
      if (safe && c.buf.length > 0) return { body: { ...body, base64: c.buf.toString("base64"), ...(c.complete || body.encoding ? {} : { truncated: true }) }, shown: null, restore: [] };
    }
    return { body, shown: null, restore: [] };
  };
  const reqSide = sideOf(req, reqMasked, "request");
  const resSide = sideOf(res, resMasked, "response");

  const base = {
    startedAt: raw.startedAt.toISOString(),
    durationMs: Math.max(0, Math.round(raw.durationMs)),
    method: raw.method,
    service: found ? { sdkId: found.service.sdkId, slug: found.service.slug } : undefined,
    operation: found?.op.name,
    region: scope.region,
    status: raw.status,
    ...(raw.error ? { error: raw.error } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(declared !== undefined ? { declared } : {}),
    ...(emulatorGap !== undefined ? { emulatorGap } : {}),
  };
  const call: Omit<CallDetail, "id" | "run"> = {
    ...base,
    path: maskedPath,
    query: formatQuery(maskedQuery),
    hidden,
    request: { headers: reqMasked.headers, body: reqSide.body },
    response: { headers: resMasked.headers, body: resSide.body },
  };
  if (hidden === 0) return { call };

  // What "Show" puts back: only the original text of what was replaced.
  const restore: Restore = {};
  if (maskedPath !== path) restore.path = path;
  if (call.query !== formatQuery(keptQuery)) restore.query = formatQuery(keptQuery);
  const rh = changed(keptHeaders, reqMasked.headers);
  if (rh.length) restore.requestHeaders = rh;
  const sh = changed(keptResponseHeaders, resMasked.headers);
  if (sh.length) restore.responseHeaders = sh;
  if (reqSide.restore.length) restore.requestBody = reqSide.restore;
  if (resSide.restore.length) restore.responseBody = resSide.restore;
  if (reqSide.withheldText !== undefined) restore.requestWithheld = { text: reqSide.withheldText, truncated: req.body.truncated === true };
  if (resSide.withheldText !== undefined) restore.responseWithheld = { text: resSide.withheldText, truncated: res.body.truncated === true };
  return { call, restore };
}
