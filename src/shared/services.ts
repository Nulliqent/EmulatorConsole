// How the Services page reads a ServiceSummary: the Resources and Emulator columns, and the filters. Pure functions,
// so the page and its tests share them.

import { isCurated } from "./curated.js";
import type { ServiceSummary } from "./models.js";

/**
 * The Resources column, in this order.
 * - `listed`: the Emulator implements a List or Describe that lists without input (`listOperations`). The test is on
 *   that array, never `listClass`: 13 services are classed `list` by the model and have none the Emulator implements.
 * - `get-or-search`: no such operation, but a Get or Search that lists without input (`getOrSearchOperations`). It may
 *   return settings rather than resources, so no list page is drawn from it.
 * - `needs-input`: only List or Describe operations that need input (`inputListOperations`, such as Budgets'
 *   DescribeBudgets). Tag lists do not count.
 * - `none`: none of these.
 */
export type ResourcesState = "listed" | "get-or-search" | "needs-input" | "none";

export function resourcesState(s: ServiceSummary): ResourcesState {
  if (s.listOperations.length > 0) return "listed";
  if (s.getOrSearchOperations.length > 0) return "get-or-search";
  if (s.inputListOperations.length > 0) return "needs-input";
  return "none";
}

/** The "Has resource lists" filter: `listOperations.length > 0`. */
export function hasResourceLists(s: ServiceSummary): boolean {
  return s.listOperations.length > 0;
}

/** The "Everything implemented" filter and the Emulator column: every operation of the model has a working handler. */
export function allImplemented(s: ServiceSummary): boolean {
  return s.notImplemented === 0 && s.notInEmulator === 0;
}

export type ServiceFilters = { text: string; curated: boolean; lists: boolean; implemented: boolean };

export const NO_FILTERS: ServiceFilters = { text: "", curated: false, lists: false, implemented: false };

/** What a filter on text searches: the title, the SDK ID and the slug, lower case. */
export function searchKey(s: ServiceSummary): string {
  return `${s.title}\n${s.sdkId}\n${s.slug}`.toLowerCase();
}

/**
 * The services that pass every filter in force, in the order given. Text matches as a substring of the title, SDK ID
 * or slug, ignoring case; spaces in the text are ignored when matching against the SDK ID and slug, so "api gateway"
 * also finds "ApiGatewayV2".
 */
export function filterServices(services: readonly ServiceSummary[], f: ServiceFilters): ServiceSummary[] {
  const text = f.text.trim().toLowerCase().replace(/\s+/g, " ");
  const compact = text.replace(/ /g, "");
  return services.filter((s) => {
    if (f.curated && !isCurated(s.sdkId)) return false;
    if (f.lists && !hasResourceLists(s)) return false;
    if (f.implemented && !allImplemented(s)) return false;
    if (text === "") return true;
    return searchKey(s).includes(text) || `${s.sdkId}\n${s.slug}`.toLowerCase().includes(compact);
  });
}

/** Services in A to Z order of their titles. */
export function sortByTitle(services: readonly ServiceSummary[]): ServiceSummary[] {
  return [...services].sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.sdkId.localeCompare(b.sdkId));
}
