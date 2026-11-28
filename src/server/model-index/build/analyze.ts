import type { ListClass, OperationInfo, OperationListKind, Protocol } from "../../../shared/models.js";
import { sensitivePaths } from "../sensitive.js";
import type { SmithyShape } from "../types.js";

/** Plain code-point order: the same on every machine and locale. */
export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type Traits = Record<string, unknown> | undefined;
type Ast = { shapes: Record<string, SmithyShape> };
type Ref = { target: string };

const UNIT = "smithy.api#Unit";

// Traits dropped from the stored shapes: prose, examples and tests, endpoint rule sets, IAM metadata. None of them
// changes how a request is built, sent or read, and together they are about 90% of the models' bytes.
const DROPPED_TRAITS = new Set([
  "smithy.api#documentation",
  "smithy.api#examples",
  "smithy.api#externalDocumentation",
  "smithy.api#tags",
  "smithy.api#since",
  "smithy.api#unstable",
  "smithy.api#suppress",
  "smithy.api#references",
  "smithy.api#cors",
  "aws.api#docs",
]);
const DROPPED_NAMESPACES = ["smithy.rules#", "smithy.test#", "smithy.waiters#", "aws.iam#"];

function keepTrait(name: string): boolean {
  return !DROPPED_TRAITS.has(name) && !DROPPED_NAMESPACES.some((p) => name.startsWith(p));
}

function pruneTraits(traits: Traits): Record<string, unknown> | undefined {
  if (!traits) return undefined;
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(traits)) {
    if (!keepTrait(name)) continue;
    // The legacy enum trait carries a documentation string per value.
    if (name === "smithy.api#enum" && Array.isArray(value)) {
      kept[name] = value.map((v: Record<string, unknown>) => {
        const { documentation: _documentation, ...rest } = v;
        void _documentation;
        return rest;
      });
    } else kept[name] = value;
  }
  return Object.keys(kept).length ? kept : undefined;
}

function pruneMember<M extends { target: string; traits?: Record<string, unknown> }>(m: M | undefined): M | undefined {
  if (!m) return undefined;
  const { traits, ...rest } = m;
  const kept = pruneTraits(traits);
  return (kept ? { ...rest, traits: kept } : rest) as M;
}

export function pruneShape(shape: SmithyShape): SmithyShape {
  const { traits, members, member, key, value, ...rest } = shape;
  const out: SmithyShape = { ...rest } as SmithyShape;
  const t = pruneTraits(traits);
  if (t) out.traits = t;
  if (members) {
    out.members = {};
    for (const [name, m] of Object.entries(members)) out.members[name] = pruneMember(m)!;
  }
  if (member) out.member = pruneMember(member);
  if (key) out.key = pruneMember(key);
  if (value) out.value = pruneMember(value);
  return out;
}

export type ServiceFacts = {
  shapeId: string;
  service: SmithyShape;
  sdkId: string;
  title: string;
  protocol: Protocol;
  protocols: string[];
  awsQueryCompatible: boolean;
  signingName?: string;
  endpointPrefix?: string;
  arnNamespace?: string;
  commonErrors: string[];
  operationIds: string[];
};

const PROTOCOL_PREFERENCE: Protocol[] = ["restJson1", "awsJson1_0", "awsJson1_1", "awsQuery", "ec2Query", "restXml"];
const PROTOCOL_TRAITS: Record<string, string> = {
  "aws.protocols#restJson1": "restJson1",
  "aws.protocols#awsJson1_0": "awsJson1_0",
  "aws.protocols#awsJson1_1": "awsJson1_1",
  "aws.protocols#awsQuery": "awsQuery",
  "aws.protocols#ec2Query": "ec2Query",
  "aws.protocols#restXml": "restXml",
  "smithy.protocols#rpcv2Cbor": "rpcv2Cbor",
  "aws.protocols#awsQueryCompatible": "awsQueryCompatible",
};

/**
 * The protocol the Emulator speaks for a service: the first one the model declares, leaving out rpcv2Cbor (a second
 * door onto the same service) unless it is the only one, and awsQueryCompatible (a variant, reported on its own).
 */
export function primaryProtocol(declared: string[]): Protocol {
  const first = declared.find((p) => (PROTOCOL_PREFERENCE as string[]).includes(p));
  if (first) return first as Protocol;
  if (declared.includes("rpcv2Cbor")) return "rpcv2Cbor";
  throw new Error(`no supported protocol among ${declared.join(", ")}`);
}

/** Operations bound to the service, directly or through its resources (any depth). Sorted by name. */
export function reachableOperations(ast: Ast, service: SmithyShape): string[] {
  const ops = new Set<string>();
  const seen = new Set<string>();
  const visitResource = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const r = ast.shapes[id] as Record<string, unknown> | undefined;
    if (!r) return;
    for (const k of ["create", "put", "read", "update", "delete", "list"]) {
      const ref = r[k] as Ref | undefined;
      if (ref) ops.add(ref.target);
    }
    for (const k of ["operations", "collectionOperations"]) for (const o of (r[k] as Ref[] | undefined) ?? []) ops.add(o.target);
    for (const c of (r.resources as Ref[] | undefined) ?? []) visitResource(c.target);
  };
  for (const o of (service.operations as Ref[] | undefined) ?? []) ops.add(o.target);
  for (const r of (service.resources as Ref[] | undefined) ?? []) visitResource(r.target);
  return [...ops].sort((a, b) => byCodePoint(a.split("#")[1], b.split("#")[1]));
}

export function readService(ast: Ast, modelPath: string): ServiceFacts {
  const found = Object.entries(ast.shapes).filter(([, s]) => s.type === "service");
  if (found.length !== 1) throw new Error(`${modelPath}: expected one service shape, found ${found.length}`);
  const [shapeId, service] = found[0];
  const traits = (service.traits ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const awsService = traits["aws.api#service"] ?? {};
  const sdkId: string | undefined = awsService.sdkId;
  if (!sdkId) throw new Error(`${modelPath}: service has no aws.api#service sdkId`);
  const protocols = Object.keys(traits)
    .map((t) => PROTOCOL_TRAITS[t])
    .filter((p): p is string => Boolean(p));
  return {
    shapeId,
    service,
    sdkId,
    title: (traits["smithy.api#title"] as string | undefined) ?? sdkId,
    protocol: primaryProtocol(protocols),
    protocols,
    awsQueryCompatible: protocols.includes("awsQueryCompatible"),
    signingName: traits["aws.auth#sigv4"]?.name,
    endpointPrefix: awsService.endpointPrefix,
    arnNamespace: awsService.arnNamespace,
    commonErrors: ((service.errors as Ref[] | undefined) ?? []).map((e) => e.target),
    operationIds: reachableOperations(ast, service),
  };
}

const isUnit = (id: string | undefined): id is undefined => !id || id === UNIT;
const hasTrait = (t: Traits, name: string) => Boolean(t && name in t);


const requiredMembers = (shape: SmithyShape | undefined) =>
  Object.values(shape?.members ?? {}).some((m) => hasTrait(m.traits, "smithy.api#required"));

const returnsCollection = (ast: Ast, shape: SmithyShape | undefined) =>
  Object.values(shape?.members ?? {}).some((m) => {
    const t = ast.shapes[m.target]?.type;
    return t === "list" || t === "set" || t === "map";
  });

/**
 * Whether an operation lists without input: named List or Describe (tier 1) or Get or Search (tier 2), takes no
 * required member, and returns a collection (a list, set or map member of its output).
 */
export function listKind(ast: Ast, opId: string): OperationListKind | undefined {
  const op = ast.shapes[opId] as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!op) return undefined;
  const name = opId.split("#")[1];
  const input = op.input?.target as string | undefined;
  const output = op.output?.target as string | undefined;
  if (!isUnit(input) && requiredMembers(ast.shapes[input])) return undefined;
  if (isUnit(output) || !returnsCollection(ast, ast.shapes[output])) return undefined;
  if (/^(List|Describe)/.test(name)) return "list";
  if (/^(Get|Search)/.test(name)) return "get-or-search";
  return undefined;
}

/**
 * Whether an operation is a List or Describe that returns a collection but takes at least one required member, so it
 * lists only once the Developer supplies input (Budgets' DescribeBudgets needs AccountId).
 */
export function listsNeedInput(ast: Ast, opId: string): boolean {
  const op = ast.shapes[opId] as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!op) return false;
  const name = opId.split("#")[1];
  const input = op.input?.target as string | undefined;
  const output = op.output?.target as string | undefined;
  if (!/^(List|Describe)/.test(name)) return false;
  if (/^ListTags|TagsForResource$/.test(name)) return false; // a tag list is not a list of resources
  if (isUnit(input) || !requiredMembers(ast.shapes[input])) return false;
  return !isUnit(output) && returnsCollection(ast, ast.shapes[output]);
}

export function classifyService(kinds: (OperationListKind | undefined)[]): ListClass {
  if (kinds.includes("list")) return "list";
  if (kinds.includes("get-or-search")) return "get-or-search";
  return "none";
}

/** Everything the index records about one operation, except its implementation label. */
export function describeOperation(ast: Ast, opId: string, memo: Map<string, string[]>): Omit<OperationInfo, "implementation"> {
  const op = ast.shapes[opId] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const traits = (op.traits ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const input = op.input?.target as string | undefined;
  const output = op.output?.target as string | undefined;
  const http = traits["smithy.api#http"] as { method: string; uri: string; code?: number } | undefined;
  const info: Omit<OperationInfo, "implementation"> = {
    name: opId.split("#")[1],
    shapeId: opId,
    errors: ((op.errors as Ref[] | undefined) ?? []).map((e) => e.target),
    readonly: hasTrait(traits, "smithy.api#readonly"),
    idempotent: hasTrait(traits, "smithy.api#idempotent"),
    paginated: hasTrait(traits, "smithy.api#paginated"),
    sensitive: { input: sensitivePaths(ast.shapes, input, memo), output: sensitivePaths(ast.shapes, output, memo) },
  };
  if (!isUnit(input)) info.input = input;
  if (!isUnit(output)) info.output = output;
  if (http) info.http = { method: http.method, uri: http.uri, ...(http.code && http.code !== 200 ? { code: http.code } : {}) };
  const list = listKind(ast, opId);
  if (list) info.list = list;
  if (listsNeedInput(ast, opId)) info.listNeedsInput = true;
  return info;
}
