// Types for GET /api/find, imported by both the server and the UI. Types only, no runtime code.
import type { ImplementationLabel, ModelIndexMeta } from "./models.js";

/** A service in Find's results. */
export type FindService = { sdkId: string; slug: string; title: string };

/** An operation in Find's results, with the service it belongs to and whether the Emulator implements it. */
export type FindOperation = { name: string; implementation: ImplementationLabel; service: FindService };

/**
 * GET /api/find?q=text. Services and operations whose name matches, best first and capped. `moreServices` and
 * `moreOperations` count matches left out by the cap. `notOffered` holds titles of Service Models the Emulator does
 * not offer that match the text. An empty `q` answers with the Curated Services.
 */
export type FindResponse = {
  emulator: ModelIndexMeta["emulator"];
  q: string;
  services: FindService[];
  operations: FindOperation[];
  moreServices: number;
  moreOperations: number;
  notOffered: string[];
};
