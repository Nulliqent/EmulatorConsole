import { nv } from "@smithy/core/serde";
import type { TruncatedMember, ValidationProblem } from "../../shared/send.js";
import type { Shapes } from "../model-index/index.js";
import type { SmithyShape } from "../model-index/types.js";
import { scrubBytes } from "./scrub.js";

// Walks a JSON value against a service's shape graph: checks it against the model's constraints, converts it into the
// values the SDK's serializers take (Date, Uint8Array, BigInt), and converts parsed output back into JSON.

type Ref = { target: string; traits?: Record<string, unknown> };
type Traits = Record<string, unknown> | undefined;

const own = <T>(o: Record<string, T> | undefined, k: string): T | undefined => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const trait = (traits: Traits, name: string): unknown => own(traits, `smithy.api#${name}`);

const PRIMITIVE_TYPES: Record<string, string> = {
  "smithy.api#String": "string",
  "smithy.api#Blob": "blob",
  "smithy.api#Boolean": "boolean",
  "smithy.api#PrimitiveBoolean": "boolean",
  "smithy.api#Integer": "integer",
  "smithy.api#PrimitiveInteger": "integer",
  "smithy.api#Long": "long",
  "smithy.api#PrimitiveLong": "long",
  "smithy.api#Float": "float",
  "smithy.api#PrimitiveFloat": "float",
  "smithy.api#Double": "double",
  "smithy.api#PrimitiveDouble": "double",
  "smithy.api#Short": "short",
  "smithy.api#PrimitiveShort": "short",
  "smithy.api#Byte": "byte",
  "smithy.api#PrimitiveByte": "byte",
  "smithy.api#BigInteger": "bigInteger",
  "smithy.api#BigDecimal": "bigDecimal",
  "smithy.api#Timestamp": "timestamp",
  "smithy.api#Document": "document",
};

const INT_RANGES: Record<string, [number, number]> = {
  byte: [-128, 127],
  short: [-32768, 32767],
  integer: [-2147483648, 2147483647],
};

type Resolved = { type: string; shape?: SmithyShape; id: string };

function resolve(shapes: Shapes, id: string): Resolved {
  const prim = own(PRIMITIVE_TYPES, id);
  if (prim) return { type: prim, id };
  const shape = own(shapes, id);
  return { type: shape?.type ?? "unknown", shape, id };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The members a structure's input must carry: `@required` without a `@default`. */
const isRequired = (m: Ref) => trait(m.traits, "required") !== undefined && trait(m.traits, "default") === undefined;

function enumValues(shape: SmithyShape): Array<string | number> {
  return Object.entries(shape.members ?? {}).map(([name, m]) => {
    const v = trait(m.traits, "enumValue");
    return typeof v === "string" || typeof v === "number" ? v : name;
  });
}

function numericValue(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return undefined;
}

function blobBytes(v: unknown): Uint8Array | undefined {
  if (typeof v === "string") return /^[A-Za-z0-9+/_-]*={0,2}$/.test(v) ? Buffer.from(v, "base64") : undefined;
  if (isObject(v) && typeof v.text === "string" && Object.keys(v).length === 1) return Buffer.from(v.text, "utf8");
  return undefined;
}

function timestampDate(v: unknown): Date | undefined {
  if (typeof v === "number") return new Date(v * 1000);
  if (typeof v !== "string") return undefined;
  const text = v.trim();
  // Blank text is not epoch 0, and digits are seconds.
  if (text === "") return undefined;
  return new Date(/^-?\d+(\.\d+)?$/.test(text) ? Number(text) * 1000 : text);
}

const INTEGER_TEXT = /^-?\d+$/;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

const patternCache = new Map<string, RegExp | null>();
/** A model pattern as a RegExp: with the `u` flag, else without it (some patterns are valid only that way); null when neither compiles. */
function compilePattern(p: string): RegExp | null {
  if (patternCache.has(p)) return patternCache.get(p)!;
  let re: RegExp | null = null;
  for (const flags of ["u", ""]) {
    try {
      re = new RegExp(p, flags);
      break;
    } catch {
      // try the next form
    }
  }
  if (patternCache.size > 2000) patternCache.clear();
  patternCache.set(p, re);
  return re;
}

/** The value of a 64-bit-or-larger integer given as digits, when it is not a safe JS integer. */
function unsafeInteger(v: unknown): bigint | undefined {
  if (typeof v !== "string" || !INTEGER_TEXT.test(v.trim())) return undefined;
  const n = BigInt(v.trim());
  return n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER) ? n : undefined;
}

const stepName = (path: string, name: string) => (path ? `${path}.${name}` : name);

// ---------------------------------------------------------------------------------------------------------------
// Validation

const MAX_PROBLEMS = 100;
const MAX_DEPTH = 64;

/** Checks `input` against the operation's input shape: required members, types, length, range, pattern and enum. */
export function validateInput(shapes: Shapes, inputShapeId: string | undefined, input: unknown): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const add = (path: string, rule: ValidationProblem["rule"], message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ path, rule, message });
  };

  const check = (id: string, memberTraits: Traits, value: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const { type, shape } = resolve(shapes, id);
    const constraint = (name: string) => [trait(memberTraits, name), trait(shape?.traits, name)].filter((c) => c !== undefined);
    const label = path || "input";
    switch (type) {
      case "string":
      case "enum": {
        if (typeof value !== "string") return add(path, "type", `${label} must be a string.`);
        for (const c of constraint("length") as { min?: number; max?: number }[]) {
          const n = [...value].length;
          if (c.min !== undefined && n < c.min) add(path, "length", `${label} must be at least ${c.min} characters.`);
          if (c.max !== undefined && n > c.max) add(path, "length", `${label} must be at most ${c.max} characters.`);
        }
        for (const p of constraint("pattern") as string[]) {
          // A pattern JavaScript cannot compile is skipped rather than reported against the Developer.
          const re = compilePattern(p);
          if (re && !re.test(value)) add(path, "pattern", `${label} must match ${p}.`);
        }
        if (type === "enum" && shape && !enumValues(shape).includes(value)) {
          add(path, "enum", `${label} must be one of: ${enumValues(shape).join(", ")}.`);
        }
        return;
      }
      case "intEnum": {
        const n = numericValue(value);
        if (n === undefined || !Number.isInteger(n)) return add(path, "type", `${label} must be an integer.`);
        if (shape && !enumValues(shape).includes(n)) add(path, "enum", `${label} must be one of: ${enumValues(shape).join(", ")}.`);
        return;
      }
      case "boolean":
        if (typeof value !== "boolean") add(path, "type", `${label} must be true or false.`);
        return;
      case "byte":
      case "short":
      case "integer":
      case "long":
      case "float":
      case "double": {
        const n = typeof value === "boolean" ? undefined : numericValue(value);
        if (n === undefined || (Number.isNaN(n) && !(typeof value === "string" && value === "NaN"))) return add(path, "type", `${label} must be a number.`);
        const whole = type !== "float" && type !== "double";
        if (whole && !Number.isInteger(n)) return add(path, "type", `${label} must be a whole number.`);
        const limit = own(INT_RANGES, type);
        if (limit && (n < limit[0] || n > limit[1])) add(path, "range", `${label} must be between ${limit[0]} and ${limit[1]}.`);
        if (type === "long") {
          // Digits beyond the safe range are compared exactly, as 64-bit integers.
          const big = typeof value === "string" && INTEGER_TEXT.test(value.trim()) ? BigInt(value.trim()) : undefined;
          if (big !== undefined && (big < LONG_MIN || big > LONG_MAX)) add(path, "range", `${label} must be between -9223372036854775808 and 9223372036854775807.`);
          else if (big === undefined && Math.abs(n) > 2 ** 63) add(path, "range", `${label} must be between -9223372036854775808 and 9223372036854775807.`);
        }
        for (const c of constraint("range") as { min?: number; max?: number }[]) {
          if (c.min !== undefined && n < c.min) add(path, "range", `${label} must be at least ${c.min}.`);
          if (c.max !== undefined && n > c.max) add(path, "range", `${label} must be at most ${c.max}.`);
        }
        return;
      }
      case "bigInteger":
      case "bigDecimal":
        if (typeof value !== "string" && typeof value !== "number") add(path, "type", `${label} must be a number or a numeric string.`);
        else if (Number.isNaN(Number(value))) add(path, "type", `${label} must be a number.`);
        return;
      case "timestamp":
        if (timestampDate(value) === undefined || Number.isNaN(timestampDate(value)!.getTime())) {
          add(path, "type", `${label} must be a date such as 2026-11-26T10:00:00Z, or seconds since 1970.`);
        }
        return;
      case "blob": {
        const bytes = blobBytes(value);
        if (!bytes) return add(path, "type", `${label} must be base64 text, or { "text": "..." }.`);
        for (const c of constraint("length") as { min?: number; max?: number }[]) {
          if (c.min !== undefined && bytes.length < c.min) add(path, "length", `${label} must be at least ${c.min} bytes.`);
          if (c.max !== undefined && bytes.length > c.max) add(path, "length", `${label} must be at most ${c.max} bytes.`);
        }
        return;
      }
      case "document":
        return;
      case "list":
      case "set": {
        if (!Array.isArray(value)) return add(path, "type", `${label} must be a list.`);
        for (const c of constraint("length") as { min?: number; max?: number }[]) {
          if (c.min !== undefined && value.length < c.min) add(path, "length", `${label} must have at least ${c.min} items.`);
          if (c.max !== undefined && value.length > c.max) add(path, "length", `${label} must have at most ${c.max} items.`);
        }
        const element = shape?.member;
        // A sparse list may hold nulls.
        const sparse = trait(shape?.traits, "sparse") !== undefined;
        if (element) value.forEach((v, i) => (sparse && v === null ? undefined : check(element.target, element.traits, v, `${path}[${i}]`, depth + 1)));
        return;
      }
      case "map": {
        if (!isObject(value)) return add(path, "type", `${label} must be an object.`);
        const keys = Object.keys(value);
        for (const c of constraint("length") as { min?: number; max?: number }[]) {
          if (c.min !== undefined && keys.length < c.min) add(path, "length", `${label} must have at least ${c.min} entries.`);
          if (c.max !== undefined && keys.length > c.max) add(path, "length", `${label} must have at most ${c.max} entries.`);
        }
        for (const k of keys) {
          const at = `${path}[${JSON.stringify(k)}]`;
          if (shape?.key) check(shape.key.target, shape.key.traits, k, `${at} (key)`, depth + 1);
          if (shape?.value && !(value[k] === null && trait(shape.traits, "sparse") !== undefined)) check(shape.value.target, shape.value.traits, value[k], at, depth + 1);
        }
        return;
      }
      case "structure":
      case "union": {
        if (!isObject(value)) return add(path, "type", `${label} must be an object.`);
        const members = shape?.members ?? {};
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(members, key)) add(stepName(path, key), "unknown-member", `${stepName(path, key)} is not a member of ${path || "the input"}.`);
        }
        if (type === "union") {
          const set = Object.keys(value).filter((k) => Object.hasOwn(members, k));
          if (set.length !== 1) add(path, "type", `${label} must set exactly one of: ${Object.keys(members).join(", ")}.`);
        }
        for (const [name, m] of Object.entries(members)) {
          const at = stepName(path, name);
          const present = Object.hasOwn(value, name) && value[name] !== undefined && value[name] !== null;
          if (!present) {
            if (type === "structure" && isRequired(m)) add(at, "required", `${at} is required.`);
            continue;
          }
          check(m.target, m.traits, value[name], at, depth + 1);
        }
        return;
      }
      default:
        return;
    }
  };

  if (inputShapeId && inputShapeId !== "smithy.api#Unit") check(inputShapeId, undefined, input ?? {}, "", 0);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON in, SDK values out

/** Converts the Developer's JSON into what the SDK serializers take. Values that do not fit their type pass through unchanged. */
export function toSdkInput(shapes: Shapes, inputShapeId: string | undefined, input: unknown): unknown {
  if (!inputShapeId || inputShapeId === "smithy.api#Unit") return {};

  const convert = (id: string, value: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH || value === undefined) return undefined;
    // A null is dropped, except in a sparse list or map, where the caller keeps it.
    if (value === null) return undefined;
    const { type, shape } = resolve(shapes, id);
    switch (type) {
      case "blob":
        return blobBytes(value) ?? value;
      case "timestamp": {
        // An unparseable date passes through as written, so `sendInvalid` sends what the Developer typed.
        const date = timestampDate(value);
        return date && !Number.isNaN(date.getTime()) ? date : value;
      }
      case "long":
      case "byte":
      case "short":
      case "integer":
      case "float":
      case "double":
      case "intEnum":
        // Digits beyond the safe range become a bigint, which the SDK's serializers write exactly.
        if (type === "long") {
          const big = unsafeInteger(value);
          if (big !== undefined) return big;
        }
        return typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      case "bigInteger":
        try {
          return typeof value === "string" || typeof value === "number" ? BigInt(typeof value === "string" ? value.trim() : value) : value;
        } catch {
          return value;
        }
      case "bigDecimal":
        return typeof value === "string" || typeof value === "number" ? nv(String(value)) : value;
      case "list":
      case "set":
        return Array.isArray(value) && shape?.member
          ? value.map((v) => (v === null && trait(shape.traits, "sparse") !== undefined ? null : convert(shape.member!.target, v, depth + 1)))
          : value;
      case "map": {
        if (!isObject(value) || !shape?.value) return value;
        const out = Object.create(null) as Record<string, unknown>;
        const sparse = trait(shape.traits, "sparse") !== undefined;
        for (const [k, v] of Object.entries(value)) out[k] = v === null && sparse ? null : convert(shape.value.target, v, depth + 1);
        return out;
      }
      case "structure":
      case "union": {
        if (!isObject(value)) return value;
        const out = Object.create(null) as Record<string, unknown>;
        for (const [name, m] of Object.entries(shape?.members ?? {})) {
          if (!Object.hasOwn(value, name)) continue;
          const converted = convert(m.target, value[name], depth + 1);
          if (converted !== undefined) out[name] = converted;
        }
        return out;
      }
      default:
        return value;
    }
  };

  return convert(inputShapeId, input ?? {}, 0) ?? {};
}


// ---------------------------------------------------------------------------------------------------------------
// SDK values in, JSON out

const DROPPED_KEYS = new Set(["$metadata", "$fault", "$response", "$retryable", "$service", "__type"]);

/** Blobs and streams in `output` keep at most this many bytes; the rest is dropped and listed in `truncatedMembers`. */
export const OUTPUT_BLOB_LIMIT = 256 * 1024;

type StreamLike = { transformToByteArray(): Promise<Uint8Array> };
const isStream = (v: unknown): v is StreamLike => typeof v === "object" && v !== null && typeof (v as StreamLike).transformToByteArray === "function";
const isNumericValue = (v: unknown): v is { string: string } =>
  typeof v === "object" && v !== null && typeof (v as { string?: unknown }).string === "string" && "type" in v;

export type JsonOptions = {
  /** The run's keys. Blob bytes are scrubbed before they become base64, where a text scrub could not see them. */
  secrets?: readonly string[];
  /** Filled with the blob members that were cut. */
  truncated?: TruncatedMember[];
};

/**
 * Parsed output as JSON: dates as ISO 8601; blobs and streams as base64 of at most 256 KB (longer ones are cut and
 * listed in `options.truncated`); 64-bit integers as numbers when safe and as strings when not. SDK bookkeeping
 * (`$metadata`) is dropped.
 */
export async function toJson(value: unknown, options: JsonOptions = {}, path = "", depth = 0): Promise<unknown> {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      // Without the type, a number is kept as it is (NaN and the infinities, which JSON cannot hold, become strings).
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
    case "function":
    case "symbol":
      return null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isStream(value) || value instanceof Uint8Array) {
    const bytes = isStream(value) ? await value.transformToByteArray() : (value as Uint8Array);
    const clean = scrubBytes(bytes, options.secrets ?? []);
    if (clean.length > OUTPUT_BLOB_LIMIT) options.truncated?.push({ path, size: clean.length });
    return Buffer.from(clean.buffer, clean.byteOffset, Math.min(clean.length, OUTPUT_BLOB_LIMIT)).toString("base64");
  }
  if (isNumericValue(value)) return value.string;
  if (value instanceof String) return value.toString();
  if (Array.isArray(value) || value instanceof Set) {
    const items = [...value];
    const out: unknown[] = [];
    for (let i = 0; i < items.length; i++) out.push(await toJson(items[i], options, `${path}[${i}]`, depth + 1));
    return out;
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(value)) {
    if (DROPPED_KEYS.has(k) || v === undefined) continue;
    out[k] = await toJson(v, options, path ? `${path}.${k}` : k, depth + 1);
  }
  return out;
}
