import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FindResponse } from "../shared/find";
import { isCurated } from "../shared/curated";
import { normalizeQuery } from "../shared/query";
import { focusHeading } from "./focus";
import { Link, useRouter } from "./router";
import { loadServiceIndex } from "./serviceIndex";
import { S } from "./strings";

/** The Find shortcut: Command-K on macOS, Control-K elsewhere. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const FIND_HINT = IS_MAC ? "⌘K" : "Ctrl K";

export type FindHandle = { open: () => void };

/** How long typing pauses before Find asks the server. */
const DEBOUNCE_MS = 120;

type Option = { id: string; to: string; kind: "service" | "operation"; name: string; service: string; sub?: string; curated: boolean; notImplemented: boolean };

function optionsOf(r: FindResponse | null): Option[] {
  if (!r) return [];
  const services = r.services.map((s): Option => ({
    id: `find-opt-s-${s.slug}`,
    to: `/services/${encodeURIComponent(s.slug)}`,
    kind: "service",
    name: s.title,
    service: s.title,
    sub: s.sdkId,
    curated: isCurated(s.sdkId),
    notImplemented: false,
  }));
  const operations = r.operations.map((o): Option => ({
    id: `find-opt-o-${o.service.slug}-${o.name}`,
    to: `/services/${encodeURIComponent(o.service.slug)}/ops/${encodeURIComponent(o.name)}`,
    kind: "operation",
    name: o.name,
    service: o.service.title,
    curated: false,
    notImplemented: o.implementation !== "implemented",
  }));
  return [...services, ...operations];
}

/**
 * Find (`scr-find`): an ARIA combobox in a native dialog. The input owns focus the whole time; `aria-activedescendant`
 * names the highlighted option, Arrow Up and Down move it, Enter opens it. The dialog is native, so Escape closes it
 * and focus goes back to the control that opened it; choosing a result closes it and moves focus to the opened page's
 * h1 instead. Results come from GET /api/find (services first, then operations, capped).
 */
export const FindDialog = forwardRef<FindHandle>(function FindDialog(_props, ref) {
  const { navigate } = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const chosen = useRef(false);
  const enterPending = useRef(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FindResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  // aria-activedescendant is set only once an arrow key has moved the highlight, so a screen reader is not told about an
  // option before the Developer has chosen to move.
  const [navigated, setNavigated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      const d = dialog.current;
      if (!d || d.open) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      chosen.current = false;
      setQuery("");
      setActive(0);
      setNavigated(false);
      setResult(null); // an answer from the last time Find was open must not show again
      setFailed(false);
      setIsOpen(true);
      d.showModal();
      void loadServiceIndex().catch(() => {}); // the page that opens next needs it
    },
  }));

  // Ask the server whenever the text changes while Find is open. A reply for an earlier text is dropped.
  useEffect(() => {
    if (!isOpen) return;
    enterPending.current = false;
    const controller = new AbortController();
    const t = window.setTimeout(
      () => {
        fetch(`/api/find?q=${encodeURIComponent(query)}`, { signal: controller.signal })
          .then(async (res) => {
            if (!res.ok) throw new Error(String(res.status));
            const body = (await res.json()) as FindResponse;
            if (controller.signal.aborted) return; // an answer to text that has since changed
            setResult(body);
            setFailed(false);
            setActive(0);
            setNavigated(false);
            if (enterPending.current) {
              enterPending.current = false;
              const first = optionsOf(body)[0];
              if (first) choose(first);
            }
          })
          .catch((e: unknown) => {
            if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
            setResult(null); // never show an earlier answer beside the failure
            setFailed(true);
          });
      },
      query === "" ? 0 : DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(t);
      controller.abort();
    };
  }, [query, isOpen]);

  const options = useMemo(() => optionsOf(result), [result]);
  const typed = normalizeQuery(query);
  // Results belong to the text they answered; the first answer after opening may still be on its way.
  const current = result !== null && result.q === typed;
  const empty = current && typed !== "" && options.length === 0;
  const activeOption = options[active];

  // Announced politely, inside the dialog (the page behind a modal dialog is inert): the count, once it is known.
  const notOfferedNow = current ? (result?.notOffered ?? []) : [];
  const capped = current && ((result?.moreServices ?? 0) > 0 || (result?.moreOperations ?? 0) > 0);
  const status = failed
    ? S.findFailed
    : current && typed !== ""
      ? options.length === 0 && notOfferedNow.length > 0
        ? notOfferedNow.map(S.findNotOffered).join(" ")
        : capped
          ? S.findResultsCapped(options.length)
          : S.findResults(options.length)
      : "";

  useEffect(() => {
    if (activeOption) document.getElementById(activeOption.id)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOption]);

  function choose(o: Option) {
    chosen.current = true;
    dialog.current?.close();
    navigate(o.to);
    // When the choice is the page already open the path does not change, so the shell does not move focus itself.
    requestAnimationFrame(focusHeading);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      // The first arrow key only names the highlighted option (the first), so it is heard before any move.
      if (!navigated) {
        setNavigated(true);
        return;
      }
      setActive((i) => Math.max(0, Math.min(options.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeOption && current) choose(activeOption);
      else enterPending.current = true; // opens the first result as soon as the answer arrives
    }
  }

  const version = result?.emulator.version ?? "";
  const group = (kind: Option["kind"], title: string, id: string) => {
    const items = options.filter((o) => o.kind === kind);
    if (items.length === 0) return null;
    return (
      <div role="group" aria-labelledby={id}>
        <div className="grp" id={id}>
          {title}
        </div>
        {items.map((o) => (
          <div
            key={o.id}
            id={o.id}
            role="option"
            aria-selected={o === activeOption}
            className={`opt${o === activeOption ? " on" : ""}`}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input
            onClick={() => choose(o)}
          >
            <b className={kind === "operation" ? "mono" : undefined}>{o.name}</b>
            <span className="muted">{o.kind === "operation" ? o.service : o.sub}</span>
            {o.curated && <span className="badge">{S.curatedBadge}</span>}
            {o.notImplemented && <span className="badge">{S.findNotImplemented(version)}</span>}
          </div>
        ))}
      </div>
    );
  };

  const r = current ? result : null;
  const offered = r?.notOffered ?? [];
  const browseClosesFind = () => {
    chosen.current = true;
    dialog.current?.close();
    requestAnimationFrame(focusHeading);
  };

  return (
    <dialog
      ref={dialog}
      id="find"
      aria-label={S.findLabel}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // the backdrop
      }}
      onClose={() => {
        // A close event can arrive after Find has been opened again (it is queued, not immediate): ignore that one.
        if (dialog.current?.open) return;
        setIsOpen(false);
        // Native close restores focus too; this keeps it right where the browser does not.
        if (!chosen.current) opener.current?.focus();
      }}
    >
      <div className="dlg">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={options.length > 0 ? "find-list" : undefined}
          aria-activedescendant={navigated && activeOption && current ? activeOption.id : undefined}
          aria-autocomplete="list"
          aria-label={S.findPlaceholder}
          placeholder={S.findPlaceholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="sr" role="status" aria-live="polite" data-testid="find-status">
          {status}
        </div>
        {options.length > 0 && (
          <div role="listbox" id="find-list" aria-label={S.findLabel} className="findlist">
            {group("service", S.findGroupServices, "find-g-services")}
            {group("operation", S.findGroupOperations, "find-g-operations")}
          </div>
        )}
        {r && (r.moreServices > 0 || r.moreOperations > 0) && (
          <p className="findnote">
            {[r.moreServices > 0 && S.findMoreServices(r.moreServices), r.moreOperations > 0 && S.findMoreOperations(r.moreOperations)]
              .filter(Boolean)
              .join(" ")}
          </p>
        )}
        {r && offered.length > 0 && (
          <div className="findnote" data-testid="find-notoffered">
            {offered.map((name) => (
              <p key={name}>{S.findNotOffered(name)}</p>
            ))}
          </div>
        )}
        {(empty || (current && options.length === 0 && offered.length > 0)) && (
          <p className="findnote" data-testid="find-nomatch">
            {offered.length === 0 && <>{S.findNoMatch(r?.q ?? typed)} </>}
            <Link to="/services" onClick={browseClosesFind}>
              {S.findBrowse}
            </Link>
          </p>
        )}
        {failed && <p className="findnote">{S.findFailed}</p>}
      </div>
    </dialog>
  );
});
