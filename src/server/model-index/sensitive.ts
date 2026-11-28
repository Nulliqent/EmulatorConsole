import type { SmithyShape } from "./types.js";

// Helpers over a service's shape graph (`ServiceModelFile.shapes`) for finding members AWS marks `@sensitive`.
// Masking walks a decoded value against the graph with `childrenOf`; the path lists in the index are a summary for display.

export type Shapes = Record<string, SmithyShape>;
type Ref = { target: string; traits?: Record<string, unknown> };

export const SENSITIVE = "smithy.api#sensitive";

const own = (shapes: Shapes, id: string): SmithyShape | undefined => (Object.hasOwn(shapes, id) ? shapes[id] : undefined);
const hasTrait = (traits: Record<string, unknown> | undefined, name: string) => Boolean(traits && Object.hasOwn(traits, name));

/** Whether a shape itself carries `@sensitive`. An unknown id is not sensitive. */
export function isSensitiveShape(shapes: Shapes, shapeId: string): boolean {
  return hasTrait(own(shapes, shapeId)?.traits, SENSITIVE);
}

/** A member (or list element, map key or map value) is sensitive when it carries the trait or its target shape does. */
export function isSensitiveMember(shapes: Shapes, member: Ref): boolean {
  return hasTrait(member.traits, SENSITIVE) || isSensitiveShape(shapes, member.target);
}

export type Child = {
  /** How a value is reached from its parent: a member name, `[]` (list or set element), `{key}` or `{}` (map key, value). */
  step: string;
  target: string;
  sensitive: boolean;
};

/**
 * The shapes one level below a shape: structure and union members, list and set elements, map keys and values
 * (error shapes are structures). Scalars have none. Recursion is the caller's to bound: shapes may refer back to
 * their ancestors.
 */
export function childrenOf(shapes: Shapes, shapeId: string): Child[] {
  const shape = own(shapes, shapeId);
  if (!shape) return [];
  const child = (step: string, m: Ref): Child => ({ step, target: m.target, sensitive: isSensitiveMember(shapes, m) });
  switch (shape.type) {
    case "structure":
    case "union":
      return Object.entries(shape.members ?? {}).map(([name, m]) => child(name, m));
    case "list":
    case "set":
      return shape.member ? [child("[]", shape.member)] : [];
    case "map":
      return [...(shape.key ? [child("{key}", shape.key)] : []), ...(shape.value ? [child("{}", shape.value)] : [])];
    default:
      return [];
  }
}

/** The path that stands for the whole input or output when that structure is itself sensitive. */
export const ROOT_PATH = "$";

type Walked = { paths: string[]; cut: boolean };

/**
 * Paths from a shape to every sensitive member under it, for display: `Password`, `Config.Token`, `Items[].Secret`,
 * `Map{}.Secret`, `Map{key}`; `$` when the shape itself is sensitive. Sensitive members are not descended into.
 * A reference back to an ancestor ends that branch. Results of subtrees that contain such a cycle are never
 * reused, so the answer does not depend on the order shapes are visited in.
 */
export function sensitivePaths(shapes: Shapes, rootId: string | undefined, memo: Map<string, string[]> = new Map()): string[] {
  if (!rootId || rootId === "smithy.api#Unit") return [];
  if (isSensitiveShape(shapes, rootId)) return [ROOT_PATH];
  const inProgress = new Set<string>();

  const walk = (id: string): Walked => {
    const cached = memo.get(id);
    if (cached) return { paths: cached, cut: false };
    if (inProgress.has(id)) return { paths: [], cut: true };
    inProgress.add(id);
    const paths: string[] = [];
    let cut = false;
    for (const c of childrenOf(shapes, id)) {
      const sep = c.step === "[]" || c.step === "{}" || c.step === "{key}" ? "" : ".";
      if (c.sensitive) paths.push(sep + c.step);
      else {
        const sub = walk(c.target);
        for (const p of sub.paths) paths.push(sep + c.step + p);
        cut ||= sub.cut;
      }
    }
    inProgress.delete(id);
    // A subtree with a cycle in it reads differently under different ancestors, so only cycle-free ones are reused.
    if (!cut) memo.set(id, paths);
    return { paths, cut };
  };

  return [...new Set(walk(rootId).paths.map((p) => p.replace(/^\./, "")))].sort();
}

/**
 * Every shape reachable from the given roots, following members, elements, keys, values and (for operations)
 * input, output and errors. Shapes are returned with their traits unchanged, so `smithy.api#error`, `aws.protocols#awsQueryError`
 * and `smithy.api#httpError` stay available.
 */
export function reachableShapes(shapes: Shapes, rootIds: string[]): Shapes {
  const out: Shapes = Object.create(null) as Shapes;
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    const shape = own(shapes, id);
    if (!shape || Object.hasOwn(out, id)) continue;
    out[id] = shape;
    for (const c of childrenOf(shapes, id)) stack.push(c.target);
    if (shape.type === "operation") {
      for (const k of ["input", "output"]) {
        const t = (shape[k] as Ref | undefined)?.target;
        if (t) stack.push(t);
      }
      for (const e of (shape.errors as Ref[] | undefined) ?? []) stack.push(e.target);
    }
  }
  return out;
}
