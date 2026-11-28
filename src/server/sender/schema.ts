import * as protocols from "@aws-sdk/core/protocols";
import { TypeRegistry, operation as operationSchema } from "@smithy/core/schema";
import * as serde from "@smithy/core/serde";
import type { Protocol, ServiceSummary } from "../../shared/models.js";
import { reachableShapes } from "../model-index/index.js";
import type { ServiceModelFile, SmithyShape } from "../model-index/index.js";

// Converts a service's Smithy shape graph (the Service Model index) into the static schemas the AWS SDK's protocol
// classes serialize and parse with. The schema format is the SDK's own (`[kind, namespace, name, traits, ...]`); a
// simple type is a bare number. Traits the protocols read are translated from their Smithy names to the SDK's short ones.

type Schema = unknown;
type Traits = Record<string, unknown>;

/** The number the SDK uses for each Smithy scalar. */
const SIMPLE: Record<string, number> = {
  "smithy.api#String": 0,
  "smithy.api#Blob": 21,
  "smithy.api#Boolean": 2,
  "smithy.api#PrimitiveBoolean": 2,
  "smithy.api#Integer": 1,
  "smithy.api#PrimitiveInteger": 1,
  "smithy.api#Long": 1,
  "smithy.api#PrimitiveLong": 1,
  "smithy.api#Float": 1,
  "smithy.api#PrimitiveFloat": 1,
  "smithy.api#Double": 1,
  "smithy.api#PrimitiveDouble": 1,
  "smithy.api#Short": 1,
  "smithy.api#PrimitiveShort": 1,
  "smithy.api#Byte": 1,
  "smithy.api#PrimitiveByte": 1,
  "smithy.api#BigInteger": 17,
  "smithy.api#BigDecimal": 19,
  "smithy.api#Timestamp": 4,
  "smithy.api#Document": 15,
};
const KIND: Record<string, number> = {
  string: 0, enum: 0, intEnum: 1, blob: 21, boolean: 2, integer: 1, long: 1, float: 1, double: 1, short: 1, byte: 1,
  bigInteger: 17, bigDecimal: 19, timestamp: 4, document: 15,
};
const TIMESTAMP: Record<string, number> = { "date-time": 5, "http-date": 6, "epoch-seconds": 7 };
const STREAMING_BLOB = 42;
const TIMESTAMP_KIND = 4;
const BLOB_KIND = 21;

const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const trait = (s: { traits?: Traits } | undefined, name: string) => own(s?.traits, `smithy.api#${name}`);

const FLAGS = new Set([
  "httpLabel", "httpPayload", "httpResponseCode", "httpQueryParams", "sparse", "streaming", "xmlFlattened", "xmlAttribute",
  "eventHeader", "eventPayload", "hostLabel", "idempotencyToken", "sensitive",
]);
const VALUES = new Set(["httpHeader", "httpQuery", "httpPrefixHeaders", "jsonName", "xmlName", "mediaType", "error", "httpError"]);

/** The SDK's short trait names for the Smithy traits the protocol classes read. */
function translateTraits(traits: Traits | undefined): Traits {
  const out: Traits = {};
  for (const [key, v] of Object.entries(traits ?? {})) {
    const [ns, name] = key.split("#") as [string, string];
    if (ns === "smithy.api") {
      if (FLAGS.has(name)) out[name] = 1;
      else if (VALUES.has(name)) out[name] = v;
      else if (name === "xmlNamespace") {
        const x = v as { prefix?: string; uri: string };
        out.xmlNamespace = [x.prefix ?? "", x.uri];
      } else if (name === "http") {
        const h = v as { method: string; uri: string; code?: number };
        out.http = [h.method, h.uri, h.code ?? 200];
      } else if (name === "endpoint") out.endpoint = [(v as { hostPrefix: string }).hostPrefix];
    } else if (key === "aws.protocols#ec2QueryName") out.ec2QueryName = v;
    else if (key === "aws.protocols#awsQueryError") {
      const e = v as { code: string; httpResponseCode: number };
      out.awsQueryError = [e.code, e.httpResponseCode];
    }
  }
  return out;
}

export type ProtocolInstance = {
  setSerdeContext(context: unknown): void;
  serializeRequest(op: unknown, input: unknown, context: unknown): Promise<unknown>;
  deserializeResponse(op: unknown, context: unknown, response: unknown): Promise<unknown>;
};

export type SerdeContext = Record<string, unknown>;

export type CompiledService = {
  sdkId: string;
  protocol: Protocol;
  /** The name SigV4 signs with, such as "sqs" or "s3". */
  signingName: string;
  /** The service shape's name, such as "AmazonSQS". CBOR needs it in `__smithy_context`. */
  serviceName: string;
  /** A fresh protocol object: they hold per-request context, so never share one between requests. */
  createProtocol(): ProtocolInstance;
  /** What the protocol classes need to serialize and parse one operation: codecs, and the endpoint they build URLs from. */
  createContext(operation: string, endpoint: { hostname: string; port: number }): SerdeContext;
  /** The operation's input or output holds an event stream (a `@streaming` union), which the Console cannot send. */
  hasEventStream(operation: string): boolean;
  /** The SDK schema for one operation. `undefined` when the model has no such operation. */
  operation(name: string): Schema | undefined;
  /** The schema of any shape of the service, built the first time it is asked for. Throws when the model refers to a shape it lacks. */
  shape(id: string): Schema;
};

const cache = new WeakMap<ServiceModelFile, CompiledService>();

/** Builds (once per loaded model) what the protocol classes need for a service. */
export function compileService(detail: ServiceModelFile, summary: ServiceSummary): CompiledService {
  const hit = cache.get(detail);
  if (hit) return hit;
  const compiled = build(detail, summary);
  cache.set(detail, compiled);
  return compiled;
}

function build(detail: ServiceModelFile, summary: ServiceSummary): CompiledService {
  const shapes = detail.shapes;
  const service = own(shapes, detail.serviceShapeId) as SmithyShape;
  const [namespace, serviceName] = detail.serviceShapeId.split("#") as [string, string];
  const schemas = new Map<string, Schema>();

  const reference = (id: string, memberTraits: Traits = {}): Schema => {
    const simple = own(SIMPLE, id);
    if (simple !== undefined) {
      if (simple === TIMESTAMP_KIND) {
        const f = memberTraits["smithy.api#timestampFormat"] as string | undefined;
        if (f && Object.hasOwn(TIMESTAMP, f)) return TIMESTAMP[f];
      }
      return simple;
    }
    // Union members that carry no value (`smithy.api#Unit`) are not in the model's shape list.
    if (id === "smithy.api#Unit") return () => shape(id);
    const s = own(shapes, id);
    if (!s) throw new Error(`Service Model has no shape ${id}`);
    const base = own(KIND, s.type);
    if (base !== undefined) {
      let v = base;
      if (v === TIMESTAMP_KIND) {
        const f = (memberTraits["smithy.api#timestampFormat"] ?? trait(s, "timestampFormat")) as string | undefined;
        if (f && Object.hasOwn(TIMESTAMP, f)) v = TIMESTAMP[f] as number;
      }
      if (v === BLOB_KIND && trait(s, "streaming") !== undefined) v = STREAMING_BLOB;
      const t = translateTraits(s.traits);
      delete t.streaming;
      const [ns, name] = id.split("#") as [string, string];
      return Object.keys(t).length ? [0, ns, name, t, v] : v;
    }
    return () => shape(id);
  };

  const member = (m: { target: string; traits?: Traits }): Schema => {
    const r = reference(m.target, m.traits);
    const t = translateTraits(m.traits);
    return Object.keys(t).length ? [r, t] : r;
  };

  const shape = (id: string): Schema => {
    if (id === "smithy.api#Unit") return "unit";
    const cached = schemas.get(id);
    if (cached) return cached;
    const s = own(shapes, id);
    if (!s) throw new Error(`Service Model has no shape ${id}`);
    const [ns, name] = id.split("#") as [string, string];
    const t = translateTraits(s.traits);
    let out: Schema;
    if (s.type === "list" || s.type === "set") out = [1, ns, name, t, member(s.member!)];
    else if (s.type === "map") out = [2, ns, name, t, member(s.key!), member(s.value!)];
    else {
      const entries = Object.entries(s.members ?? {});
      const names = entries.map((e) => e[0]);
      const members = entries.map((e) => member(e[1]));
      out = [trait(s, "error") !== undefined ? -3 : s.type === "union" ? 4 : 3, ns, name, t, names, members];
    }
    schemas.set(id, out);
    return out;
  };

  // Every error shape of the service is registered, so the protocol classes can build a modelled error from the wire code.
  // A registry the Console owns, not `TypeRegistry.for(namespace)`: that one is process-global and shared with the SDK.
  const registry = new TypeRegistry(`console:${detail.serviceShapeId}`);
  for (const [id, s] of Object.entries(shapes)) {
    if (s.type !== "structure" || trait(s, "error") === undefined) continue;
    const name = id.split("#")[1]!;
    class ModelledError extends Error {
      constructor(o?: { message?: string }) {
        super(o?.message ?? "");
        this.name = name;
      }
    }
    registry.registerError(shape(id) as never, ModelledError as never);
  }

  const traits = service.traits ?? {};
  const awsQueryCompatible = Object.hasOwn(traits, "aws.protocols#awsQueryCompatible");
  const xmlNamespace = (trait(service, "xmlNamespace") as { uri?: string } | undefined)?.uri;
  const options = {
    defaultNamespace: namespace,
    errorTypeRegistries: [registry],
    serviceTarget: serviceName,
    xmlNamespace,
    version: service.version as string | undefined,
  };
  const P = protocols as unknown as Record<string, new (o: unknown) => ProtocolInstance>;
  const createProtocol = (): ProtocolInstance => {
    switch (summary.protocol) {
      case "restJson1": return new P.AwsRestJsonProtocol!(options);
      case "awsJson1_0": return new P.AwsJson1_0Protocol!({ ...options, awsQueryCompatible });
      case "awsJson1_1": return new P.AwsJson1_1Protocol!({ ...options, awsQueryCompatible });
      case "awsQuery": return new P.AwsQueryProtocol!(options);
      case "ec2Query": return new P.AwsEc2QueryProtocol!(options);
      case "restXml": return new P.AwsRestXmlProtocol!(options);
      case "rpcv2Cbor": return new P.AwsSmithyRpcV2CborProtocol!(options);
    }
  };

  const sigv4 = own(traits, "aws.auth#sigv4") as { name?: string } | undefined;
  return {
    sdkId: summary.sdkId,
    protocol: summary.protocol,
    signingName: sigv4?.name ?? summary.signingName ?? summary.endpointPrefix ?? summary.slug,
    serviceName,
    createProtocol,
    createContext(operation, endpoint) {
      return {
        endpoint: async () => ({ protocol: "https:", hostname: endpoint.hostname, port: endpoint.port, path: "/" }),
        disableHostPrefix: true,
        // The CBOR protocol builds its path from these.
        __smithy_context: { service: serviceName, operation },
        utf8Encoder: serde.toUtf8,
        utf8Decoder: serde.fromUtf8,
        base64Encoder: serde.toBase64,
        base64Decoder: serde.fromBase64,
        streamCollector: serde.streamCollector,
        bodyLengthChecker: serde.calculateBodyLength,
      };
    },
    hasEventStream(name) {
      const op = detail.operations.find((o) => o.name === name);
      if (!op) return false;
      const roots = [op.input, op.output].filter((r): r is string => !!r);
      return Object.values(reachableShapes(shapes, roots)).some((x) => x.type === "union" && trait(x, "streaming") !== undefined);
    },
    shape,
    operation(name) {
      const op = detail.operations.find((o) => o.name === name);
      if (!op) return undefined;
      const s = own(shapes, op.shapeId)!;
      return operationSchema(namespace, name, translateTraits(s.traits) as never, shape(op.input ?? "smithy.api#Unit") as never, shape(op.output ?? "smithy.api#Unit") as never);
    },
  };
}
