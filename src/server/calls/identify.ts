import type { OperationInfo, Protocol, ServiceSummary } from "../../shared/models.js";
import type { ModelIndex } from "../model-index/index.js";
import type { ServiceModelFile } from "../model-index/types.js";
import { matchSegments, parseUriTemplate, pathSegments, type RouteSegment } from "./mask.js";

// Which service and operation a request is, from the Service Model index. By protocol:
//  - awsJson: the X-Amz-Target header, `Prefix.Operation`
//  - awsQuery, ec2Query: the `Action` form parameter (body or query string); also for JSON services that accept it (SQS)
//  - restJson1, restXml: the method and path against each operation's `http` trait (and the query keys it requires)
//  - rpcv2Cbor: the path `/service/<Service>/operation/<Operation>`
// The request's SigV4 signing name narrows the services that can match. An unsigned query request (STS
// AssumeRoleWithWebIdentity) has none, so every query service with that Action is a candidate, narrowed by `Version`.

export type Identified = {
  service: ServiceSummary;
  detail: ServiceModelFile;
  op: OperationInfo;
  /** The protocol the request was written in. A JSON service can be called in awsQuery, so this may differ from `service.protocol`. */
  wire: Protocol;
  /** Segments the URI template has ahead of the path (an S3 virtual-host bucket, taken from the Host). */
  pathPrefix: string[];
};

export type IdentifyInput = {
  method: string;
  /** The URL path as sent (percent-encoded). */
  path: string;
  /** Decoded query parameters. */
  query: [string, string][];
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  /** The request body as text (form-encoded bodies matter here), or "" if none. */
  body: string;
  /** The signing name from the credential scope, such as "s3". */
  signingName?: string;
};

type Route = { op: OperationInfo; method: string; segments: RouteSegment[]; required: [string, string | null][]; literals: number };
type Compiled = { byName: Map<string, OperationInfo>; routes: Route[] };

const compiled = new WeakMap<ServiceModelFile, Compiled>();

function compile(detail: ServiceModelFile): Compiled {
  let c = compiled.get(detail);
  if (!c) {
    const routes: Route[] = [];
    for (const op of detail.operations) {
      if (!op.http) continue;
      const t = parseUriTemplate(op.http.uri);
      routes.push({ op, method: op.http.method.toUpperCase(), segments: t.segments, required: t.query, literals: t.segments.filter((s) => "literal" in s).length });
    }
    c = { byName: new Map(detail.operations.map((o) => [o.name, o])), routes };
    compiled.set(detail, c);
  }
  return c;
}

const bySigning = new WeakMap<ModelIndex, Map<string, ServiceSummary[]>>();

function candidatesFor(index: ModelIndex, signingName: string | undefined): ServiceSummary[] {
  if (!signingName) return [];
  let map = bySigning.get(index);
  if (!map) {
    map = new Map();
    for (const s of index.services()) {
      for (const key of new Set([s.signingName, s.endpointPrefix].filter((k): k is string => !!k))) {
        const list = map.get(key) ?? [];
        list.push(s);
        map.set(key, list);
      }
    }
    bySigning.set(index, map);
  }
  return map.get(signingName.toLowerCase()) ?? [];
}

/** Whether the index has a service the signing name belongs to. A request signed for one that no operation matched is not trusted. */
export function knownService(index: ModelIndex, signingName: string | undefined): boolean {
  return candidatesFor(index, signingName).length > 0;
}

/** The name an awsJson X-Amz-Target prefix has: the service shape's own name. */
const shapeName = (s: ServiceSummary) => s.shapeId.replace(/^.*#/, "");

const S3_ENDPOINT = /^s3([.-][a-z0-9-]+)*\.amazonaws\.com(\.cn)?$/;

/**
 * The S3 virtual-host bucket named by a Host such as `bucket.localhost:9300` or `bucket.s3.amazonaws.com`. Only a Host
 * whose remainder is `localhost`, an S3 endpoint or one of the Gateway's own names (`ownNames`) counts; anything else
 * (an IP address, a bare name, `host.docker.internal`) is path style.
 */
export function virtualHostBucket(host: string | undefined, ownNames: string[] = []): string | undefined {
  if (!host) return undefined;
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name) || name.includes(":")) return undefined;
  const dot = name.indexOf(".");
  if (dot <= 0) return undefined;
  const first = name.slice(0, dot);
  const rest = name.slice(dot + 1);
  if (first === "s3" || first.startsWith("s3-")) return undefined;
  if (rest === "localhost" || S3_ENDPOINT.test(rest) || ownNames.some((n) => n.toLowerCase() === rest)) return first;
  return undefined;
}

/** How well a route fits a request: null when it doesn't, else a score (more literal segments and required keys win). */
function scoreRoute(r: Route, input: IdentifyInput, segs: string[], have: Map<string, string>): number | null {
  {
    if (r.method !== input.method.toUpperCase()) return null;
    if (!matchSegments(r.segments, segs)) return null;
    // Every query key the template names must be there, and a key with a value must have it. `x-id` only says which
    // operation an S3 SDK meant (`?x-id=GetObject`); other clients leave it off, so it is optional, and preferred when it matches.
    let score = r.literals * 10;
    let ok = true;
    const copying = input.headers["x-amz-copy-source"] !== undefined;
    for (const [k, v] of r.required) {
      if (k === "x-id") {
        if (have.has(k)) {
          if (v !== null && have.get(k) !== v) ok = false;
          else score += 1;
        } else if (v === "CopyObject" || v === "UploadPartCopy") {
          // Without x-id the copy is told from a plain write by its source header.
          if (copying) score += 2;
          else ok = false;
        }
        continue;
      }
      if (!have.has(k) || (v !== null && have.get(k) !== v)) ok = false;
      else score += 100;
    }
    return ok ? score : null;
  }
}

function matchRest(detail: ServiceModelFile, input: IdentifyInput, prefix: string[]): OperationInfo | undefined {
  const segs = [...prefix, ...pathSegments(input.path)];
  const have = new Map<string, string>(input.query);
  let best: { route: Route; score: number } | undefined;
  for (const r of compile(detail).routes) {
    const score = scoreRoute(r, input, segs, have);
    if (score !== null && (!best || score > best.score)) best = { route: r, score };
  }
  return best?.route.op;
}

type TableEntry = { sdkId: string; route: Route };
const tables = new WeakMap<ModelIndex, Promise<TableEntry[]>>();

/** Every REST route of every REST service, read once: for a request with no signing name to say which service it is. */
function restTable(index: ModelIndex): Promise<TableEntry[]> {
  let table = tables.get(index);
  if (!table) {
    table = (async () => {
      const entries: TableEntry[] = [];
      for (const s of index.services()) {
        if (s.protocol !== "restJson1" && s.protocol !== "restXml") continue;
        const detail = await index.detail(s.sdkId);
        if (detail) for (const route of compile(detail).routes) entries.push({ sdkId: s.sdkId, route });
      }
      return entries;
    })();
    tables.set(index, table);
    table.catch(() => tables.delete(index));
  }
  return table;
}

/** An unsigned REST request: the best route over every service; ambiguous between services is not identified. */
async function matchUnsignedRest(index: ModelIndex, input: IdentifyInput): Promise<Identified | undefined> {
  const segs = pathSegments(input.path);
  const have = new Map<string, string>(input.query);
  let best: { entry: TableEntry; score: number } | undefined;
  let rivals = new Set<string>();
  for (const entry of await restTable(index)) {
    const score = scoreRoute(entry.route, input, segs, have);
    if (score === null) continue;
    if (!best || score > best.score) {
      best = { entry, score };
      rivals = new Set([entry.sdkId]);
    } else if (score === best.score) rivals.add(entry.sdkId);
  }
  if (!best || rivals.size > 1) return undefined;
  const service = index.service(best.entry.sdkId)!;
  const detail = await index.detail(service.sdkId);
  return detail ? { service, detail, op: best.entry.route.op, wire: service.protocol, pathPrefix: [] } : undefined;
}

function formParams(input: IdentifyInput): Map<string, string> {
  const params = new Map<string, string>(input.query);
  const type = input.headers["content-type"] ?? "";
  if (input.body && type.toLowerCase().includes("application/x-www-form-urlencoded")) {
    for (const pair of input.body.split("&")) {
      const eq = pair.indexOf("=");
      const raw = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      const k = raw(eq === -1 ? pair : pair.slice(0, eq));
      if (k === "Action" || k === "Version") params.set(k, raw(eq === -1 ? "" : pair.slice(eq + 1)));
    }
  }
  return params;
}

const jsonWire = (s: ServiceSummary): Protocol => (s.protocols.find((p) => p === "awsJson1_0" || p === "awsJson1_1") as Protocol | undefined) ?? s.protocol;
const queryWire = (s: ServiceSummary): Protocol => (s.protocols.includes("ec2Query") ? "ec2Query" : "awsQuery");
const speaksQuery = (s: ServiceSummary) => s.protocols.includes("awsQuery") || s.protocols.includes("ec2Query") || s.awsQueryCompatible;

/** Identifies the service and operation of a request. Undefined when the index has no match. */
export async function identify(index: ModelIndex, input: IdentifyInput, host?: string, ownNames: string[] = []): Promise<Identified | undefined> {
  const candidates = candidatesFor(index, input.signingName);
  const target = input.headers["x-amz-target"];
  const params = formParams(input);
  const action = params.get("Action");

  const load = async (service: ServiceSummary) => {
    const detail = await index.detail(service.sdkId);
    return detail ? { service, detail } : undefined;
  };

  if (target?.includes(".")) {
    const dot = target.lastIndexOf(".");
    const prefix = target.slice(0, dot);
    const opName = target.slice(dot + 1);
    const pool = candidates.filter((s) => shapeName(s) === prefix);
    for (const service of pool.length ? pool : candidates.length ? candidates : index.services().filter((s) => shapeName(s) === prefix)) {
      const loaded = await load(service);
      const op = loaded && compile(loaded.detail).byName.get(opName);
      if (loaded && op) return { service, detail: loaded.detail, op, wire: jsonWire(service), pathPrefix: [] };
    }
    return undefined;
  }

  if (action) {
    // Signed: the signing name narrows it. Unsigned (STS AssumeRoleWithWebIdentity): every query service is a candidate.
    const pool = (candidates.length ? candidates : index.services()).filter(speaksQuery);
    const hits: Identified[] = [];
    for (const service of pool) {
      const loaded = await load(service);
      const op = loaded && compile(loaded.detail).byName.get(action);
      if (loaded && op) hits.push({ service, detail: loaded.detail, op, wire: queryWire(service), pathPrefix: [] });
    }
    if (hits.length > 1) {
      // The Version parameter is the model's date, `…/service/2011-06-15/…`.
      const version = params.get("Version");
      const byVersion = version ? hits.filter((h) => h.service.modelPath.includes(`/${version}/`)) : [];
      if (byVersion.length > 0) return byVersion[0];
    }
    return hits[0];
  }

  const cbor = /^\/service\/([^/]+)\/operation\/([^/]+)$/.exec(input.path);
  if (cbor) {
    const name = decodeURIComponent(cbor[1]!);
    const service = index.services().find((s) => s.protocols.includes("rpcv2Cbor") && shapeName(s) === name);
    const loaded = service && (await load(service));
    const op = loaded && compile(loaded.detail).byName.get(decodeURIComponent(cbor[2]!));
    return loaded && op ? { service: loaded.service, detail: loaded.detail, op, wire: "rpcv2Cbor", pathPrefix: [] } : undefined;
  }

  // REST with no signing name (SSO GetRoleCredentials, SSO OIDC CreateToken): every REST service is a candidate.
  if (!input.signingName) return matchUnsignedRest(index, input);

  // REST. An S3 virtual-host bucket is in the Host, so the template sees it as the first segment.
  const bucket = virtualHostBucket(host, ownNames);
  for (const service of candidates.filter((s) => s.protocol === "restJson1" || s.protocol === "restXml")) {
    const loaded = await load(service);
    if (!loaded) continue;
    const prefix = service.slug === "s3" && bucket ? [bucket] : [];
    const op = matchRest(loaded.detail, input, prefix);
    if (op) return { service, detail: loaded.detail, op, wire: service.protocol, pathPrefix: prefix };
  }
  return undefined;
}
