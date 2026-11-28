import { BODY_BYTE_BUDGET, CALL_LIMIT, type CallBody, type CallDetail, type CallMessage, type CallRun, type CallSummary, type CallsResponse, type GatewayCount } from "../../shared/calls.js";
import { applyReplacements, type Replacement } from "./scan.js";

/**
 * What "Show" needs to put a Call's hidden values back, kept as the original text of what was replaced and not as a
 * second copy of the Call. Signatures and session tokens are not in it: they are never kept.
 */
export type Restore = {
  path?: string;
  query?: string;
  /** Header index and original value. */
  requestHeaders?: [number, string][];
  responseHeaders?: [number, string][];
  /** Replacements in the stored (masked) body text that put the original text back. */
  requestBody?: Replacement[];
  responseBody?: Replacement[];
  /** The whole body of a withheld one, which could not be checked and so is shown only on request. */
  requestWithheld?: { text: string; truncated: boolean };
  responseWithheld?: { text: string; truncated: boolean };
};

/** What the recorder hands the store: a Call without its id and run, and what "Show" needs when anything is hidden. */
export type NewCall = { call: Omit<CallDetail, "id" | "run">; restore?: Restore };

type Stored = { call: CallDetail; restore?: Restore; bytes: number };

export type ListOptions = {
  /** At most this many (default 100, never more than 500). */
  limit?: number;
  /** Only Calls older than this id. */
  before?: number;
  /** Only Calls newer than this id (for reading what arrived since the last read). */
  after?: number;
  /** Only Calls of this Emulator Run. */
  run?: number;
};

export const DEFAULT_PAGE = 100;
export const MAX_PAGE = 500;

export function summaryOf(call: CallDetail): CallSummary {
  const summary: Partial<CallDetail> = { ...call };
  delete summary.request;
  delete summary.response;
  return summary as CallSummary;
}

const bytes = (s: string | undefined) => (s === undefined ? 0 : Buffer.byteLength(s));
const bodyBytes = (b: CallBody) => bytes(b.text) + bytes(b.base64);
const headerBytes = (headers: [string, string][]) => headers.reduce((n, [k, v]) => n + bytes(k) + bytes(v), 0);

/** What a Call holds in memory, in bytes (UTF-8): its bodies, headers, path and query, and what "Show" needs. */
function sizeOf(call: CallDetail, restore: Restore | undefined): number {
  let n = bodyBytes(call.request.body) + bodyBytes(call.response.body);
  n += headerBytes(call.request.headers) + headerBytes(call.response.headers) + bytes(call.path) + bytes(call.query);
  if (restore) {
    n += bytes(restore.path) + bytes(restore.query);
    for (const [, v] of [...(restore.requestHeaders ?? []), ...(restore.responseHeaders ?? [])]) n += bytes(v);
    for (const r of [...(restore.requestBody ?? []), ...(restore.responseBody ?? [])]) n += bytes(r.text);
    n += bytes(restore.requestWithheld?.text) + bytes(restore.responseWithheld?.text);
  }
  return n;
}

const removed = (b: CallBody): CallBody => (b.kind === "none" ? b : { kind: "removed", size: b.size, ...(b.contentType ? { contentType: b.contentType } : {}) });

function restoreBody(body: CallBody, replacements: Replacement[] | undefined, withheld: { text: string; truncated: boolean } | undefined): CallBody {
  if (withheld) {
    return { kind: "text", size: body.size, text: withheld.text, ...(withheld.truncated ? { truncated: true } : {}), ...(body.contentType ? { contentType: body.contentType } : {}) };
  }
  if (replacements && body.kind === "text" && body.text !== undefined) return { ...body, text: applyReplacements(body.text, replacements) };
  return body;
}

function restoreHeaders(headers: [string, string][], originals: [number, string][] | undefined): [string, string][] {
  if (!originals) return headers;
  const out = headers.map((h): [string, string] => [...h]);
  for (const [i, value] of originals) if (out[i]) out[i]![1] = value;
  return out;
}

/**
 * The Calls the Gateway has recorded, in memory: the latest `limit` of them, grouped by Emulator Run, and within a byte
 * budget for their bodies (past it the oldest Calls lose their bodies and keep their summaries).
 * Reading never changes anything. `add`, `clear`, `startRun` and the counters are the only writes.
 */
export class CallStore {
  private readonly stored: Stored[] = []; // oldest first; ids increase
  private readonly listeners = new Set<(call: CallSummary) => void>();
  private nextId = 1;
  private limitHit = false;
  private currentRun = 1;
  private readonly runList: CallRun[];
  private browser: GatewayCount = { count: 0, lastAt: null };
  private tls: GatewayCount = { count: 0, lastAt: null };
  private bytes = 0;
  private trimmed = 0; // how many of the oldest Calls have already lost their bodies
  private first: CallSummary | null = null;
  /** The "Record headers and status only" setting (B3). It applies to Calls recorded after it changes. */
  headersOnly = false;

  constructor(
    private readonly limit = CALL_LIMIT,
    private readonly now: () => Date = () => new Date(),
    private readonly byteBudget = BODY_BYTE_BUDGET,
  ) {
    this.runList = [{ id: 1, startedAt: now().toISOString() }];
  }

  /**
   * A new Emulator Run began (the monitor saw the run's keys change, at `at`): later Calls belong to it, and the refusal
   * counts and the run's first Call start again.
   */
  startRun(at: string): void {
    this.currentRun++;
    this.runList.push({ id: this.currentRun, startedAt: at });
    this.browser = { count: 0, lastAt: null };
    this.tls = { count: 0, lastAt: null };
    this.first = null;
  }

  /** Stores a Call and tells the subscribers. Removes the oldest Call when over the limit, and bodies when over the budget. */
  add(input: NewCall): CallSummary {
    const id = this.nextId++;
    const call: CallDetail = { ...input.call, id, run: this.currentRun };
    const size = sizeOf(call, input.restore);
    this.stored.push({ call, restore: input.restore, bytes: size });
    this.bytes += size;
    while (this.stored.length > this.limit) this.drop();
    this.trim();
    const summary = summaryOf(call);
    this.first ??= summary;
    for (const listener of this.listeners) {
      try {
        listener(summary);
      } catch {
        /* a failing subscriber must not stop the recording */
      }
    }
    return summary;
  }

  private drop() {
    const s = this.stored.shift()!;
    this.bytes -= s.bytes;
    if (this.trimmed > 0) this.trimmed--;
    this.limitHit = true;
  }

  /** Over the byte budget: the oldest Calls lose their bodies, one by one, until it fits. Their summaries and headers stay (and count). */
  private trim() {
    while (this.bytes > this.byteBudget && this.trimmed < this.stored.length) {
      const s = this.stored[this.trimmed++]!;
      s.call = { ...s.call, request: { ...s.call.request, body: removed(s.call.request.body) }, response: { ...s.call.response, body: removed(s.call.response.body) } };
      s.restore = undefined;
      const left = sizeOf(s.call, undefined);
      this.bytes -= s.bytes - left;
      s.bytes = left;
      this.limitHit = true;
    }
  }

  /** Calls newest first. Summaries only: headers and bodies come from `get`. */
  list(options: ListOptions = {}): CallsResponse {
    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? DEFAULT_PAGE)), MAX_PAGE);
    const matching = this.stored.filter(
      (s) =>
        (options.before === undefined || s.call.id < options.before) &&
        (options.after === undefined || s.call.id > options.after) &&
        (options.run === undefined || s.call.run === options.run),
    );
    // `after` reads forward from a known point, so it keeps the oldest of what's new; everything else keeps the newest.
    const page = options.after !== undefined ? matching.slice(0, limit).reverse() : matching.slice(-limit).reverse();
    return {
      calls: page.map((s) => summaryOf(s.call)),
      total: this.stored.length,
      lastId: this.nextId - 1,
      limitReached: this.limitHit,
      runs: [...this.runList],
      more: matching.length > page.length,
    };
  }

  /** One Call with its headers and bodies, hidden values still hidden. */
  get(id: number): CallDetail | undefined {
    return this.find(id)?.call;
  }

  /** The same Call with its hidden values, for the one route that sends them (the Developer pressed Show). */
  reveal(id: number): CallDetail | undefined {
    const s = this.find(id);
    if (!s) return undefined;
    const r = s.restore;
    if (!r) return s.call;
    const c = s.call;
    const message = (m: CallMessage, headers: [number, string][] | undefined, body: Replacement[] | undefined, withheld: Restore["requestWithheld"]): CallMessage => ({
      headers: restoreHeaders(m.headers, headers),
      body: restoreBody(m.body, body, withheld),
    });
    return {
      ...c,
      path: r.path ?? c.path,
      query: r.query ?? c.query,
      request: message(c.request, r.requestHeaders, r.requestBody, r.requestWithheld),
      response: message(c.response, r.responseHeaders, r.responseBody, r.responseWithheld),
    };
  }

  private find(id: number): Stored | undefined {
    let lo = 0;
    let hi = this.stored.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = this.stored[mid]!.call.id;
      if (at === id) return this.stored[mid];
      if (at < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** The first Call of the current Emulator Run since the last clear, even if it has since been removed. Null when there is none. */
  get firstOfRun(): CallSummary | null {
    return this.first;
  }

  /** Removes every Call and returns how many there were. Ids keep increasing. */
  clear(): number {
    const n = this.stored.length;
    this.stored.length = 0;
    this.bytes = 0;
    this.trimmed = 0;
    this.limitHit = false;
    this.first = null;
    return n;
  }

  /** Calls `listener` with each Call as it is stored. Returns the function that stops it. */
  subscribe(listener: (call: CallSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get total(): number {
    return this.stored.length;
  }
  get lastId(): number {
    return this.nextId - 1;
  }
  /** Bytes of bodies and restore data held now. For tests and diagnostics. */
  get heldBytes(): number {
    return this.bytes;
  }

  /** A request from a browser was refused (B2). */
  countBrowserRefusal(): void {
    this.browser = { count: this.browser.count + 1, lastAt: this.now().toISOString() };
  }
  /** A TLS connection was refused because the caller did not trust the Gateway's certificate (B4). */
  countTlsRefusal(): void {
    this.tls = { count: this.tls.count + 1, lastAt: this.now().toISOString() };
  }
  get browserRefusals(): GatewayCount {
    return this.browser;
  }
  get tlsRefusals(): GatewayCount {
    return this.tls;
  }
}
