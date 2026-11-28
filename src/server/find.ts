import { CURATED_SDK_IDS, isCurated } from "../shared/curated.js";
import type { FindOperation, FindResponse, FindService } from "../shared/find.js";
import type { ServiceSummary } from "../shared/models.js";
import { normalizeQuery } from "../shared/query.js";
import type { ModelIndex } from "./model-index/index.js";

export const MAX_SERVICES = 8;
export const MAX_OPERATIONS = 12;
const MAX_NOT_OFFERED = 3;
/** A Service Model the Emulator lacks is named only for text at least this long (unless it beats every offered service). */
const MIN_NOT_OFFERED_QUERY = 3;

/**
 * How well `q` (lower case) matches `text`: 0 the whole text, 1 its start, 2 the start of a word inside it (after a
 * space, dash or underscore, or at a capital in CamelCase), 3 anywhere. `null` for no match.
 */
export function matchRank(text: string, q: string): number | null {
  if (q === "") return null;
  const lower = text.toLowerCase();
  if (lower === q) return 0;
  if (lower.startsWith(q)) return 1;
  // Lower-casing can change a string's length (some non-ASCII letters), which would misalign the positions found in
  // `lower` with the original. Then word starts are judged on the lower-case text alone.
  const orig = lower.length === text.length ? text : lower;
  let best: number | null = null;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + 1)) {
    const prev = orig[i - 1] ?? "";
    const wordStart = /[^A-Za-z0-9]/.test(prev) || (/[A-Z]/.test(orig[i] ?? "") && /[a-z0-9]/.test(prev));
    if (wordStart) return 2;
    best = 3;
  }
  return best;
}

function serviceRank(s: { title: string; sdkId: string; slug: string }, q: string, compact: string): number | null {
  let best: number | null = null;
  for (const r of [matchRank(s.title, q), matchRank(s.sdkId, q), matchRank(s.slug, q), matchRank(s.sdkId, compact)]) {
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

const toService = (s: { sdkId: string; slug: string; title: string }): FindService => ({ sdkId: s.sdkId, slug: s.slug, title: s.title });

/**
 * Find's answer for `raw`. Services rank by how well the title, SDK ID or slug match, Curated Services first among
 * equals. Operations rank by how well the name matches (a typed space is ignored, so "list buckets" finds
 * ListBuckets), then implemented ones before the rest, then Curated Services' before others', then shorter names.
 * Both lists are capped. A Service Model the Emulator lacks is named only when it matches well (see `notOffered`).
 */
export async function find(index: ModelIndex, raw: string): Promise<FindResponse> {
  const text = normalizeQuery(raw);
  const q = text.toLowerCase();
  const compact = q.replace(/ /g, "");
  const emulator = index.meta.emulator;

  if (q === "") {
    // Opening Find asks with no text: a good moment to build the operation table, so the first search is quick.
    void index.operationTable().catch(() => {});
    const services = CURATED_SDK_IDS.map((id) => index.service(id)).filter((s): s is ServiceSummary => s !== undefined);
    return { emulator, q: text, services: services.map(toService), operations: [], moreServices: 0, moreOperations: 0, notOffered: [] };
  }

  const matchedServices = index
    .services()
    .map((s) => ({ s, rank: serviceRank(s, q, compact) }))
    .filter((x): x is { s: ServiceSummary; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || Number(isCurated(b.s.sdkId)) - Number(isCurated(a.s.sdkId)) || a.s.title.localeCompare(b.s.title));

  const table = await index.operationTable();
  const matchedOps: { name: string; sdkId: string; implementation: FindOperation["implementation"]; rank: number }[] = [];
  for (const o of table) {
    const rank = matchRank(o.name, compact);
    if (rank !== null) matchedOps.push({ ...o, rank });
  }
  matchedOps.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.implementation === "implemented") - Number(a.implementation === "implemented") ||
      Number(isCurated(b.sdkId)) - Number(isCurated(a.sdkId)) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name) ||
      a.sdkId.localeCompare(b.sdkId),
  );

  const operations = matchedOps.slice(0, MAX_OPERATIONS).map((o): FindOperation => {
    const svc = index.service(o.sdkId);
    return { name: o.name, implementation: o.implementation, service: toService(svc ?? { sdkId: o.sdkId, slug: o.sdkId, title: o.sdkId }) };
  });

  // A model the Emulator lacks is named when it matches the whole name, or when the text is at least three characters
  // (one or two letters match almost everything) and it matches at the start of a word or at least as well as the
  // best service offered.
  const bestOffered = matchedServices[0]?.rank ?? Infinity;
  const notOffered = index.meta.models.notOffered
    .map((m) => ({ title: m.title, rank: serviceRank({ title: m.title, sdkId: m.sdkId, slug: m.sdkId }, q, compact) }))
    .filter((m): m is { title: string; rank: number } => m.rank !== null && (m.rank === 0 || (compact.length >= MIN_NOT_OFFERED_QUERY && (m.rank <= 2 || m.rank <= bestOffered))))
    .slice(0, MAX_NOT_OFFERED)
    .map((m) => m.title);

  return {
    emulator,
    q: text,
    services: matchedServices.slice(0, MAX_SERVICES).map((x) => toService(x.s)),
    operations,
    moreServices: Math.max(0, matchedServices.length - MAX_SERVICES),
    moreOperations: Math.max(0, matchedOps.length - MAX_OPERATIONS),
    notOffered,
  };
}
