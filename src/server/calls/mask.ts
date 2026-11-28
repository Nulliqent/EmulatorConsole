import { HIDDEN } from "../../shared/calls.js";
import type { OperationInfo, Protocol } from "../../shared/models.js";
import { isSensitiveMember, isSensitiveShape, sensitivePaths, type Shapes } from "../model-index/sensitive.js";
import type { SmithyShape } from "../model-index/types.js";
import { applyWithRestore, scanJson, scanXml, type JsonNode, type Replacement, type XmlElement } from "./scan.js";

// Masking: walks a decoded request or response against the service's shape graph and replaces every value AWS marks
// `@sensitive` with "Hidden". The graph keeps the trait on members and on target shapes (see model-index/sensitive.ts).
// Covered: recursive shapes (the walk follows the value, which is finite), sensitive map keys, error shapes, members
// bound to httpHeader, httpPrefixHeaders, httpQuery, httpQueryParams, httpLabel and httpPayload, wire names (jsonName,
// xmlName, ec2QueryName) and the awsQuery and ec2Query flattened keys.

type Ref = { target: string; traits?: Record<string, unknown> };

export type MaskContext = {
  shapes: Shapes;
  protocol: Protocol;
  commonErrors: string[];
  op: OperationInfo;
};

const T = {
  jsonName: "smithy.api#jsonName",
  xmlName: "smithy.api#xmlName",
  xmlFlattened: "smithy.api#xmlFlattened",
  xmlAttribute: "smithy.api#xmlAttribute",
  ec2QueryName: "aws.protocols#ec2QueryName",
  httpHeader: "smithy.api#httpHeader",
  httpQuery: "smithy.api#httpQuery",
  httpQueryParams: "smithy.api#httpQueryParams",
  httpLabel: "smithy.api#httpLabel",
  httpPayload: "smithy.api#httpPayload",
  httpPrefixHeaders: "smithy.api#httpPrefixHeaders",
  awsQueryError: "aws.protocols#awsQueryError",
};

const own = (shapes: Shapes, id: string): SmithyShape | undefined => (Object.hasOwn(shapes, id) ? shapes[id] : undefined);
const traitOf = (m: Ref | undefined, name: string): unknown => (m?.traits && Object.hasOwn(m.traits, name) ? m.traits[name] : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isJson = (p: Protocol) => p === "restJson1" || p === "awsJson1_0" || p === "awsJson1_1";
const isQuery = (p: Protocol) => p === "awsQuery" || p === "ec2Query";

/** Which message a name is read from: ec2Query names a member differently in a request and in a response. */
type Side = "request" | "response";

/**
 * Every wire name a member may carry for the protocol. Over-matching only ever hides more.
 * ec2Query: a request uses `ec2QueryName`, or the capitalised `xmlName` or name; a response uses the raw `xmlName`
 * (`keyMaterial` for CreateKeyPair's KeyMaterial) or the name.
 */
function wireNames(protocol: Protocol, name: string, m: Ref, side: Side): string[] {
  const xml = str(traitOf(m, T.xmlName));
  switch (protocol) {
    case "ec2Query":
      return side === "request"
        ? [str(traitOf(m, T.ec2QueryName)), xml && cap(xml), cap(name)].filter((x): x is string => !!x)
        : [xml, name, str(traitOf(m, T.ec2QueryName)), xml && cap(xml), cap(name)].filter((x): x is string => !!x);
    case "awsQuery":
    case "restXml":
      return [xml, name].filter((x): x is string => !!x);
    default:
      return [name, str(traitOf(m, T.jsonName))].filter((x): x is string => !!x);
  }
}

type Named = { name: string; member: Ref };
const lookups = new WeakMap<SmithyShape, Map<string, Map<string, Named>>>();

/** A structure's or union's members by wire name. */
function membersByWire(protocol: Protocol, shape: SmithyShape, side: Side): Map<string, Named> {
  let perProtocol = lookups.get(shape);
  if (!perProtocol) lookups.set(shape, (perProtocol = new Map()));
  const key = `${protocol}/${side}`;
  let map = perProtocol.get(key);
  if (!map) {
    map = new Map();
    for (const [name, member] of Object.entries(shape.members ?? {})) {
      for (const w of wireNames(protocol, name, member, side)) if (!map.has(w)) map.set(w, { name, member });
    }
    perProtocol.set(key, map);
  }
  return map;
}

class Counter {
  replacements: Replacement[] = [];
  hidden = 0;
  hide(start: number, end: number, text: string) {
    this.replacements.push({ start, end, text });
    this.hidden++;
  }
}

// ---- JSON -------------------------------------------------------------------------------------------------------

function walkJson(ctx: MaskContext, node: JsonNode, shapeId: string, sensitive: boolean, out: Counter): void {
  if (sensitive || isSensitiveShape(ctx.shapes, shapeId)) return out.hide(node.start, node.end, JSON.stringify(HIDDEN));
  const shape = own(ctx.shapes, shapeId);
  if (!shape) return;
  switch (shape.type) {
    case "structure":
    case "union": {
      if (node.kind !== "object") return;
      const members = membersByWire(ctx.protocol, shape, "response");
      for (const e of node.entries) {
        const hit = members.get(e.key);
        if (hit) walkJson(ctx, e.value, hit.member.target, isSensitiveMember(ctx.shapes, hit.member), out);
      }
      return;
    }
    case "list":
    case "set": {
      if (node.kind !== "array" || !shape.member) return;
      const sens = isSensitiveMember(ctx.shapes, shape.member);
      for (const item of node.items) walkJson(ctx, item, shape.member.target, sens, out);
      return;
    }
    case "map": {
      if (node.kind !== "object") return;
      const keySens = shape.key ? isSensitiveMember(ctx.shapes, shape.key) : false;
      let n = 0;
      for (const e of node.entries) {
        // Keys are hidden by replacing the key itself; two hidden keys must not look like a repeated one.
        if (keySens) out.hide(e.keyStart, e.keyEnd, JSON.stringify(n++ === 0 ? HIDDEN : `${HIDDEN} ${n}`));
        if (shape.value) walkJson(ctx, e.value, shape.value.target, isSensitiveMember(ctx.shapes, shape.value), out);
      }
      return;
    }
    default:
  }
}

// ---- XML --------------------------------------------------------------------------------------------------------

function hideElement(el: XmlElement, out: Counter) {
  if (el.contentEnd > el.contentStart) out.hide(el.contentStart, el.contentEnd, HIDDEN);
  else out.hidden++; // an empty element: nothing to replace, but the value is counted as hidden
}

const xmlItemName = (m: Ref | undefined, fallback: string) => str(traitOf(m, T.xmlName)) ?? fallback;

function walkXmlItems(ctx: MaskContext, shape: SmithyShape, els: XmlElement[], sensitive: boolean, out: Counter) {
  if (shape.type === "map") {
    const keyName = xmlItemName(shape.key, "key");
    const valueName = xmlItemName(shape.value, "value");
    for (const entry of els) {
      for (const part of entry.children) {
        if (part.name === keyName && shape.key && (sensitive || isSensitiveMember(ctx.shapes, shape.key))) hideElement(part, out);
        else if (part.name === valueName && shape.value) walkXml(ctx, part, shape.value.target, sensitive || isSensitiveMember(ctx.shapes, shape.value), out);
      }
    }
    return;
  }
  if (!shape.member) return;
  const sens = sensitive || isSensitiveMember(ctx.shapes, shape.member);
  for (const el of els) walkXml(ctx, el, shape.member.target, sens, out);
}

function walkXml(ctx: MaskContext, el: XmlElement, shapeId: string, sensitive: boolean, out: Counter): void {
  if (sensitive || isSensitiveShape(ctx.shapes, shapeId)) return hideElement(el, out);
  const shape = own(ctx.shapes, shapeId);
  if (!shape) return;
  switch (shape.type) {
    case "structure":
    case "union": {
      const members = membersByWire(ctx.protocol, shape, "response");
      for (const a of el.attrs) {
        const hit = members.get(a.name);
        if (hit && traitOf(hit.member, T.xmlAttribute) !== undefined && isSensitiveMember(ctx.shapes, hit.member)) out.hide(a.valueStart, a.valueEnd, HIDDEN);
      }
      // Flattened lists and maps repeat the member's own element, so children are grouped by member first.
      const flat = new Map<string, XmlElement[]>();
      for (const child of el.children) {
        const hit = members.get(child.name);
        if (!hit || traitOf(hit.member, T.xmlAttribute) !== undefined) continue;
        const target = own(ctx.shapes, hit.member.target);
        const flattened = traitOf(hit.member, T.xmlFlattened) !== undefined && target && (target.type === "list" || target.type === "set" || target.type === "map");
        if (flattened) {
          const group = flat.get(hit.name) ?? [];
          group.push(child);
          flat.set(hit.name, group);
        } else walkXml(ctx, child, hit.member.target, isSensitiveMember(ctx.shapes, hit.member), out);
      }
      for (const [name, els] of flat) {
        const member = shape.members![name]!;
        const target = own(ctx.shapes, member.target)!;
        // A flattened list's elements are the member's own elements: the list member's wire name is not used.
        if (target.type === "map") walkXmlItems(ctx, target, els, isSensitiveMember(ctx.shapes, member), out);
        else if (target.member) {
          const sens = isSensitiveMember(ctx.shapes, member) || isSensitiveMember(ctx.shapes, target.member);
          for (const item of els) walkXml(ctx, item, target.member.target, sens, out);
        }
      }
      return;
    }
    case "list":
    case "set":
      return walkXmlItems(ctx, shape, el.children, false, out);
    case "map":
      return walkXmlItems(ctx, shape, el.children, false, out);
    default:
  }
}

// ---- awsQuery and ec2Query form parameters ----------------------------------------------------------------------

const isIndex = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);

/** Whether the parameter named by `tokens` (split at ".") reaches a value that is sensitive. */
function queryKeySensitive(ctx: MaskContext, shapeId: string, tokens: string[], i: number, flattened: boolean, depth = 0): boolean {
  if (depth > 100 || i >= tokens.length) return false;
  const shape = own(ctx.shapes, shapeId);
  if (!shape) return false;
  const ec2 = ctx.protocol === "ec2Query";
  switch (shape.type) {
    case "structure":
    case "union": {
      const hit = membersByWire(ctx.protocol, shape, "request").get(tokens[i]!);
      if (!hit) return false;
      if (isSensitiveMember(ctx.shapes, hit.member)) return true;
      const target = own(ctx.shapes, hit.member.target);
      const isCollection = target?.type === "list" || target?.type === "set" || target?.type === "map";
      return queryKeySensitive(ctx, hit.member.target, tokens, i + 1, isCollection && (ec2 || traitOf(hit.member, T.xmlFlattened) !== undefined), depth + 1);
    }
    case "list":
    case "set": {
      if (!shape.member) return false;
      let at = i;
      if (!flattened) {
        if (tokens[at] !== xmlItemName(shape.member, "member")) return false;
        at++;
      }
      if (!isIndex(tokens[at])) return false;
      if (isSensitiveMember(ctx.shapes, shape.member)) return true;
      return queryKeySensitive(ctx, shape.member.target, tokens, at + 1, false, depth + 1);
    }
    case "map": {
      let at = i;
      if (!flattened) {
        if (tokens[at] !== "entry") return false;
        at++;
      }
      if (!isIndex(tokens[at])) return false;
      at++;
      if (tokens[at] === xmlItemName(shape.key, "key") && shape.key) return isSensitiveMember(ctx.shapes, shape.key);
      if (tokens[at] === xmlItemName(shape.value, "value") && shape.value) {
        return isSensitiveMember(ctx.shapes, shape.value) || queryKeySensitive(ctx, shape.value.target, tokens, at + 1, false, depth + 1);
      }
      return false;
    }
    default:
      return false;
  }
}

/** Hides form parameters (a request body or query string of an awsQuery or ec2Query call) that reach sensitive members. */
function maskQueryParams(ctx: MaskContext, pairs: [string, string][], out: Counter | null): [string, string][] {
  const input = ctx.op.input;
  if (!input) return pairs;
  return pairs.map(([k, v]) => {
    if (queryParamSensitive(ctx, k)) {
      if (out) out.hidden++;
      return [k, HIDDEN];
    }
    return [k, v];
  });
}

/** Whether an awsQuery or ec2Query parameter (`Tags.member.1.Value`) reaches a sensitive member of the operation's input. */
export function queryParamSensitive(ctx: MaskContext, key: string): boolean {
  const input = ctx.op.input;
  if (!input || key === "Action" || key === "Version") return false;
  return isSensitiveShape(ctx.shapes, input) || queryKeySensitive(ctx, input, key.split("."), 0, false);
}

// ---- HTTP bindings ----------------------------------------------------------------------------------------------

type Bindings = {
  headers: Map<string, boolean>; // lower-case header name -> sensitive
  prefixes: { prefix: string; sensitive: boolean }[];
  query: Map<string, boolean>;
  queryParams: boolean; // httpQueryParams member is sensitive: hide every query value not bound by name
  labels: Map<string, boolean>;
  payload?: { target: string; sensitive: boolean };
};

function bindingsOf(ctx: MaskContext, structureId: string | undefined): Bindings {
  const b: Bindings = { headers: new Map(), prefixes: [], query: new Map(), queryParams: false, labels: new Map() };
  const shape = structureId ? own(ctx.shapes, structureId) : undefined;
  if (!shape || shape.type !== "structure") return b;
  for (const [name, m] of Object.entries(shape.members ?? {})) {
    const sens = isSensitiveMember(ctx.shapes, m);
    const header = str(traitOf(m, T.httpHeader));
    if (header) b.headers.set(header.toLowerCase(), sens);
    const prefix = str(traitOf(m, T.httpPrefixHeaders));
    if (prefix !== undefined) b.prefixes.push({ prefix: prefix.toLowerCase(), sensitive: sens });
    const q = str(traitOf(m, T.httpQuery));
    if (q) b.query.set(q, sens);
    if (traitOf(m, T.httpQueryParams) !== undefined && sens) b.queryParams = true;
    if (traitOf(m, T.httpLabel) !== undefined) b.labels.set(name, sens);
    if (traitOf(m, T.httpPayload) !== undefined) b.payload = { target: m.target, sensitive: sens };
  }
  return b;
}

function maskHeaders(b: Bindings, headers: [string, string][], out: Counter): [string, string][] {
  return headers.map(([name, value]) => {
    const lower = name.toLowerCase();
    const bound = b.headers.get(lower);
    const prefixed = b.prefixes.some((p) => p.sensitive && lower.startsWith(p.prefix));
    if (bound === true || prefixed) {
      out.hidden++;
      return [name, HIDDEN];
    }
    return [name, value];
  });
}

function maskQueryBindings(b: Bindings, pairs: [string, string][], out: Counter): [string, string][] {
  return pairs.map(([k, v]) => {
    const bound = b.query.get(k);
    if (bound === true || (bound === undefined && b.queryParams)) {
      out.hidden++;
      return [k, HIDDEN];
    }
    return [k, v];
  });
}

/** One template segment: a literal, `{Name}`, or `{Name+}` (greedy). */
export type RouteSegment = { literal: string } | { label: string; greedy: boolean };

export function parseUriTemplate(uri: string): { segments: RouteSegment[]; query: [string, string | null][] } {
  const q = uri.indexOf("?");
  const path = q === -1 ? uri : uri.slice(0, q);
  const query = q === -1 ? [] : uri.slice(q + 1).split("&").filter(Boolean).map((p): [string, string | null] => {
    const eq = p.indexOf("=");
    return eq === -1 ? [p, null] : [p.slice(0, eq), p.slice(eq + 1)];
  });
  const segments = pathSegments(path).map((s): RouteSegment => {
    const m = /^\{([^}+]+)(\+)?\}$/.exec(s);
    return m ? { label: m[1]!, greedy: m[2] === "+" } : { literal: s };
  });
  return { segments, query };
}

/** The segments of a URL path: `/a/b/` and `/a/b` are `["a","b"]`, and `/` is `[]`. */
export function pathSegments(path: string): string[] {
  const segs = path.split("/").slice(1);
  if (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
  return segs;
}

/** Matches path segments against a template. Returns the segment range of each label, or null. */
export function matchSegments(segments: RouteSegment[], actual: string[]): Map<string, [number, number]> | null {
  const labels = new Map<string, [number, number]>();
  let a = 0;
  for (let t = 0; t < segments.length; t++) {
    const seg = segments[t]!;
    if ("literal" in seg) {
      let got = actual[a++];
      try {
        got = got === undefined ? got : decodeURIComponent(got);
      } catch {
        return null;
      }
      if (got !== seg.literal) return null;
    } else if (seg.greedy) {
      const rest = segments.length - t - 1; // segments after the greedy one each take one
      const end = actual.length - rest;
      if (end <= a) return null;
      labels.set(seg.label, [a, end]);
      a = end;
    } else {
      if (a >= actual.length || actual[a] === "") return null;
      labels.set(seg.label, [a, a + 1]);
      a++;
    }
  }
  return a === actual.length ? labels : null;
}

function maskPath(ctx: MaskContext, b: Bindings, path: string, prefix: string[], out: Counter): string {
  const uri = ctx.op.http?.uri;
  if (!uri || ![...b.labels.values()].some(Boolean)) return path;
  const segs = path.split("/");
  const lead = segs.shift(); // "" before the first slash
  const labels = matchSegments(parseUriTemplate(uri).segments, [...prefix, ...pathSegments(path)]);
  if (!labels) return path;
  for (const [name, [from, to]] of labels) {
    if (!b.labels.get(name)) continue;
    // A label that came from the Host (an S3 virtual-host bucket) is not in the path.
    for (let i = Math.max(from, prefix.length); i < to; i++) segs[i - prefix.length] = HIDDEN;
    out.hidden++;
  }
  return [lead, ...segs].join("/");
}

/** The `Error` element of an error body: the root (S3), or inside `ErrorResponse` or ec2's `Response/Errors`. */
function findError(root: XmlElement, depth = 0): XmlElement | undefined {
  if (root.name === "Error") return root;
  if (depth > 3) return undefined;
  for (const c of root.children) {
    const hit = findError(c, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

// ---- Bodies -----------------------------------------------------------------------------------------------------

/** Replacements that hide sensitive values in a body, walked against `rootId`; null when the body can't be read. */
function maskBodyAgainst(ctx: MaskContext, text: string, rootId: string, wholeSensitive: boolean, errorRoot = false): Counter | null {
  const out = new Counter();
  // The body's own format decides how it is read: a JSON service may answer a query request in XML and the other way round.
  const first = /\S/.exec(text)?.[0];
  if (first === "{" || first === "[") {
    const node = scanJson(text);
    if (!node) return null;
    walkJson(ctx, node, rootId, wholeSensitive, out);
    return out;
  }
  if (first === "<" && (ctx.protocol === "restXml" || isQuery(ctx.protocol) || isJson(ctx.protocol))) {
    const root = scanXml(text);
    if (!root) return null;
    let start = root;
    if (errorRoot) {
      start = findError(root) ?? root;
    } else if (ctx.protocol === "awsQuery") {
      // <OpResponse><OpResult>…</OpResult></OpResponse>
      const result = root.children.find((c) => c.name === `${ctx.op.name}Result`);
      // Without the Result element the output can't be located; if it has sensitive members, the body is not shown.
      if (!result && hasSensitive(ctx, rootId)) return null;
      start = result ?? root;
    }
    walkXml(ctx, start, rootId, wholeSensitive, out);
    return out;
  }
  return null;
}

function hasSensitive(ctx: MaskContext, id: string | undefined): boolean {
  return id !== undefined && sensitivePaths(ctx.shapes, id).length > 0;
}

/**
 * Whether the *body* of a request, or of a response (its output and errors), may hold a sensitive value. A body that
 * can't be read (binary, encoded) is kept only when this is false. Sensitive members bound to headers don't count: they
 * are not in the body. An operation whose body is one payload (S3 GetObject's object) is sensitive only if that payload is.
 */
export function directionHasSensitive(ctx: MaskContext, direction: "request" | "response"): boolean {
  const roots = direction === "request" ? [ctx.op.input] : [ctx.op.output, ...ctx.op.errors, ...ctx.commonErrors];
  return roots.some((r) => {
    if (r === undefined) return false;
    if (isSensitiveShape(ctx.shapes, r)) return true;
    const payload = bindingsOf(ctx, r).payload;
    if (payload) return payload.sensitive || hasSensitive(ctx, payload.target);
    return hasSensitive(ctx, r);
  });
}

export type MaskedMessage = {
  headers: [string, string][];
  /** The body with sensitive values hidden. `null` means it could not be checked and has sensitive members: do not show it. */
  body: string | null;
  /** Replacements that put the hidden values back into `body` (for "Show"); empty when none were hidden or `body` is null. */
  bodyRestore: Replacement[];
  hidden: number;
};

export type RequestInput = {
  path: string;
  query: [string, string][];
  headers: [string, string][];
  body?: string;
  /** False when the body is only the first part of the request. */
  bodyComplete: boolean;
  /** Segments the URI template has before the path begins: an S3 virtual-host request carries the bucket in the Host. */
  pathPrefix: string[];
};

export type MaskedRequest = MaskedMessage & { path: string; query: [string, string][] };

/** Hides sensitive values in a request: its path labels, headers, query string and body. */
export function maskRequest(ctx: MaskContext, req: RequestInput): MaskedRequest {
  const out = new Counter();
  const input = ctx.op.input;
  const b = bindingsOf(ctx, input);
  const path = maskPath(ctx, b, req.path, req.pathPrefix, out);
  const headers = maskHeaders(b, req.headers, out);
  let query = maskQueryBindings(b, req.query, out);
  if (isQuery(ctx.protocol)) query = maskQueryParams(ctx, query, out);
  const inputSensitive = input !== undefined && isSensitiveShape(ctx.shapes, input);

  let body: string | null = req.body ?? "";
  let bodyRestore: Replacement[] = [];
  if (req.body) {
    if (isQuery(ctx.protocol)) {
      // Only the hidden values change; every other parameter is kept exactly as it was sent.
      const reps: Replacement[] = [];
      let at = 0;
      for (const raw of req.body.split("&")) {
        const eq = raw.indexOf("=");
        const rawKey = eq === -1 ? raw : raw.slice(0, eq);
        let key = rawKey;
        try {
          key = decodeURIComponent(rawKey.replace(/\+/g, " "));
        } catch {
          /* use as is */
        }
        if (queryParamSensitive(ctx, key)) {
          const valueStart = at + rawKey.length + 1;
          reps.push({ start: valueStart, end: at + raw.length, text: HIDDEN });
          // A parameter without "=" gets one.
          if (eq === -1) reps[reps.length - 1] = { start: at + raw.length, end: at + raw.length, text: `=${HIDDEN}` };
          out.hidden++;
        }
        at += raw.length + 1;
      }
      const applied = applyWithRestore(req.body, reps);
      body = applied.text;
      bodyRestore = applied.restore;
      if (!req.bodyComplete && (hasSensitive(ctx, input) || inputSensitive)) body = null;
    } else if (inputSensitive || b.payload?.sensitive) {
      out.hidden++;
      body = HIDDEN;
      bodyRestore = [{ start: 0, end: HIDDEN.length, text: req.body }];
    } else if (!input || !hasSensitive(ctx, b.payload?.target ?? input)) {
      body = req.body;
    } else {
      const walked = req.bodyComplete ? maskBodyAgainst(ctx, req.body, b.payload?.target ?? input, false) : null;
      if (walked) {
        const applied = applyWithRestore(req.body, walked.replacements);
        body = applied.text;
        bodyRestore = applied.restore;
        out.hidden += walked.hidden;
      } else body = null;
    }
  }
  return { path, query, headers, body, bodyRestore, hidden: out.hidden };
}

export type ResponseInput = {
  status: number;
  headers: [string, string][];
  body?: string;
  bodyComplete: boolean;
};

/** The shape ids of the errors this operation may return, plus the service's common errors. */
function errorShapes(ctx: MaskContext): string[] {
  return [...new Set([...ctx.op.errors, ...ctx.commonErrors])];
}

/** The error code a response names, from the header or the body, without a namespace. */
function errorCode(ctx: MaskContext, res: ResponseInput): string | undefined {
  const clean = (c: string) => c.replace(/^.*#/, "").replace(/:.*$/, "").trim();
  const header = res.headers.find(([n]) => n.toLowerCase() === "x-amzn-errortype")?.[1];
  if (header) return clean(header);
  if (!res.body) return undefined;
  if (isJson(ctx.protocol)) {
    const node = scanJson(res.body);
    if (node?.kind !== "object") return undefined;
    for (const key of ["__type", "code", "Code"]) {
      const e = node.entries.find((x) => x.key === key);
      if (e?.value.kind === "scalar") {
        try {
          const v: unknown = JSON.parse(res.body.slice(e.value.start, e.value.end));
          if (typeof v === "string") return clean(v);
        } catch {
          /* not a string */
        }
      }
    }
    return undefined;
  }
  const root = scanXml(res.body);
  const err = root && findError(root);
  const code = err?.children.find((c) => c.name === "Code");
  return code ? res.body.slice(code.contentStart, code.contentEnd).trim() : undefined;
}

/** The declared error shape a code names, by shape name or by the awsQueryError code. */
function errorShapeFor(ctx: MaskContext, code: string | undefined): string | undefined {
  if (!code) return undefined;
  return errorShapes(ctx).find((id) => {
    if (id.replace(/^.*#/, "") === code) return true;
    const q = traitOf({ target: id, traits: own(ctx.shapes, id)?.traits }, T.awsQueryError) as { code?: string } | undefined;
    return q?.code === code;
  });
}

/** Hides sensitive values in a response: its headers and its body, whether a success or an error. */
export function maskResponse(ctx: MaskContext, res: ResponseInput): MaskedMessage {
  const out = new Counter();
  const failed = res.status >= 400 || res.headers.some(([n]) => n.toLowerCase() === "x-amzn-errortype");
  const code = failed ? errorCode(ctx, res) : undefined;
  const known = failed ? errorShapeFor(ctx, code) : undefined;
  // A failure whose code names no declared error may be any of them; every candidate is applied.
  const roots: string[] = failed ? (known ? [known] : errorShapes(ctx)) : ctx.op.output ? [ctx.op.output] : [];

  // Headers: the bindings of every candidate root.
  let headers = res.headers;
  for (const root of roots) headers = maskHeaders(bindingsOf(ctx, root), headers, out);

  let body: string | null = res.body ?? "";
  let bodyRestore: Replacement[] = [];
  if (res.body) {
    const sensitiveRoots = roots.filter((r) => isSensitiveShape(ctx.shapes, r) || hasSensitive(ctx, r) || bindingsOf(ctx, r).payload?.sensitive);
    if (sensitiveRoots.length === 0) {
      body = res.body;
    } else {
      const reps: Replacement[] = [];
      let whole = false;
      let readable = res.bodyComplete;
      for (const root of sensitiveRoots) {
        const b = bindingsOf(ctx, root);
        if (isSensitiveShape(ctx.shapes, root) || b.payload?.sensitive) {
          whole = true;
          continue;
        }
        const walked = readable ? maskBodyAgainst(ctx, res.body, b.payload?.target ?? root, false, failed) : null;
        if (!walked) readable = false;
        else {
          reps.push(...walked.replacements);
          out.hidden += walked.hidden;
        }
      }
      if (whole) {
        body = HIDDEN;
        bodyRestore = [{ start: 0, end: HIDDEN.length, text: res.body }];
        out.hidden++;
      } else if (!readable) body = null;
      else {
        const applied = applyWithRestore(res.body, reps);
        body = applied.text;
        bodyRestore = applied.restore;
      }
    }
  }
  return { headers, body, bodyRestore, hidden: out.hidden };
}
