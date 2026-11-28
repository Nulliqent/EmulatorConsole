import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isCurated } from "../../shared/curated";
import type { ServiceSummary } from "../../shared/models";
import { allImplemented, filterServices, resourcesState, NO_FILTERS, type ResourcesState, type ServiceFilters } from "../../shared/services";
import { useAnnounce } from "../announce";
import { Link } from "../router";
import { nextByTypeahead, TYPEAHEAD_MS } from "../typeahead";
import { S } from "../strings";
import { useSeenServices, useServiceIndex } from "../serviceIndex";
import { Page } from "./Page";

const RESOURCES_TEXT: Record<ResourcesState, string> = {
  listed: S.resourcesListed,
  "get-or-search": S.resourcesGetSearch,
  "needs-input": S.resourcesNeedInput,
  none: S.resourcesNone,
};

function Seen({ slugs, services }: { slugs: string[]; services: ServiceSummary[] }) {
  const bySlug = useMemo(() => new Map(services.map((s) => [s.slug, s])), [services]);
  const seen = slugs.map((slug) => bySlug.get(slug)).filter((s): s is ServiceSummary => s !== undefined);
  if (seen.length === 0) return null; // no Calls yet (ticket #10 fills useSeenServices), so no row
  return (
    <section aria-labelledby="seen-h" data-testid="seen">
      <h2 id="seen-h" className="h2">
        {S.seenThisRun}
      </h2>
      <ul className="seen">
        {seen.map((s) => (
          <li key={s.slug}>
            <Link to={`/services/${encodeURIComponent(s.slug)}`}>{s.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const Row = memo(function Row({ s }: { s: ServiceSummary }) {
  return (
    <tr data-slug={s.slug}>
      <td>
        <Link to={`/services/${encodeURIComponent(s.slug)}`} className="svc">
          {s.title}
        </Link>
        {isCurated(s.sdkId) && <span className="badge">{S.curatedBadge}</span>}
      </td>
      <td className="mono">{s.sdkId}</td>
      <td>{RESOURCES_TEXT[resourcesState(s)]}</td>
      <td>{allImplemented(s) ? S.allImplemented : S.someNotImplemented}</td>
    </tr>
  );
});

/** State A4, reading: the table's header and three placeholder rows, so the page keeps its shape. */
function PlaceholderRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} aria-hidden="true" className="ph" data-testid="svcplaceholder">
          {[0, 1, 2, 3].map((c) => (
            <td key={c}>
              <span className="bar" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** The Services page (`scr-services`): every service the Emulator offers, filterable, A to Z. */
export function Services() {
  const index = useServiceIndex();
  const seen = useSeenServices();
  const say = useAnnounce();
  const [filters, setFilters] = useState<ServiceFilters>(NO_FILTERS);
  // The field stays responsive: the 436 rows catch up after the keystroke (React renders them at lower priority).
  const deferred = useDeferredValue(filters);
  const services = index.status === "ready" ? index.services : null;
  const shown = useMemo(() => (services ? filterServices(services, deferred) : []), [services, deferred]);
  const total = services?.length ?? 0;
  const typed = useRef({ text: "", at: 0 });
  const first = useRef(true);
  const shownCount = useRef(0);
  shownCount.current = shown.length;

  // The count is announced politely when the filters change and typing pauses (not on every key, not on first load),
  // also when the count is the same as before: the Developer still learns the change had that result.
  useEffect(() => {
    if (!services) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => say(S.servicesShown(shownCount.current, total)), 500);
    return () => window.clearTimeout(t);
  }, [deferred, total, services, say]);

  const set = (patch: Partial<ServiceFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtering = filters.text !== "" || filters.curated || filters.lists || filters.implemented;

  function onTableKey(e: KeyboardEvent<HTMLTableElement>) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("svc") || e.ctrlKey || e.metaKey || e.altKey) return;
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>("tbody a.svc"));
    const at = links.indexOf(target as HTMLAnchorElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = Math.min(at + 1, links.length - 1);
    else if (e.key === "ArrowUp") next = at <= 0 ? null : at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = links.length - 1;
    else if (e.key.length === 1 && (e.key !== " " || (typed.current.text !== "" && e.timeStamp - typed.current.at < TYPEAHEAD_MS))) {
      const now = e.timeStamp;
      const buf = typed.current;
      buf.text = now - buf.at < TYPEAHEAD_MS ? buf.text + e.key : e.key;
      buf.at = now;
      next = nextByTypeahead(links.map((l) => l.textContent ?? ""), at, buf.text);
    } else return;
    e.preventDefault();
    if (next !== null) links[next]?.focus();
    else if (e.key === "ArrowUp") document.getElementById("svcfilter")?.focus();
  }

  if (index.status === "error") {
    return (
      <Page title={S.servicesTitle}>
        <div className="callout bad" role="alert">
          <div>
            <b>{S.servicesFailed}</b>
            <div className="acts">
              <button type="button" className="btn primary" onClick={index.retry}>
                {S.tryAgain}
              </button>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  const ready = index.status === "ready";
  const version = ready ? index.emulatorVersion : "";
  return (
    <Page title={S.servicesTitle} sub={services ? S.servicesOffered(total) : undefined}>
      <Seen slugs={seen} services={services ?? []} />
      <section className="panel" aria-busy={!ready}>
        <div className="filterbar" role="group" aria-label={S.filterGroup}>
          <input
            id="svcfilter"
            type="search"
            value={filters.text}
            disabled={!ready}
            placeholder={S.filterServicesPlaceholder}
            aria-label={S.filterServices}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                document.querySelector<HTMLElement>("#svcrows a.svc")?.focus();
              }
            }}
          />
          {(
            [
              ["curated", S.chipCurated],
              ["lists", S.chipLists],
              ["implemented", S.chipImplemented(version)],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className="chip" disabled={!ready} aria-pressed={filters[key]} onClick={() => set({ [key]: !filters[key] })}>
              {label}
            </button>
          ))}
        </div>
        <div className="tablewrap" role="region" aria-label={S.servicesTable} aria-describedby="svchint" tabIndex={0}>
          <table className="t services" onKeyDown={onTableKey}>
            <thead>
              <tr>
                <th scope="col">{S.colService}</th>
                <th scope="col">{S.colSdkId}</th>
                <th scope="col">{S.colResources}</th>
                <th scope="col">{ready ? S.colEmulator(version) : S.colEmulatorPlain}</th>
              </tr>
            </thead>
            <tbody id="svcrows" data-testid="svcrows">
              {ready ? shown.map((s) => <Row key={s.slug} s={s} />) : <PlaceholderRows />}
            </tbody>
          </table>
        </div>
        {ready ? (
          <>
            <p className="listnote" id="svchint">
              {S.servicesJumpHint}
            </p>
            <p className="listnote">{S.labelsNote(version)}</p>
            <p className="listnote" data-testid="svccount">
              {S.servicesShown(shown.length, total)}
            </p>
          </>
        ) : (
          <p className="listnote" id="svchint" role="status">
            {S.servicesLoading}
          </p>
        )}
        {ready && shown.length === 0 && (
          <div className="listnote nomatch" data-testid="svcnomatch">
            <span>{S.servicesNoMatch(deferred.text.trim(), deferred.curated || deferred.lists || deferred.implemented)}</span>{" "}
            {filtering && (
              <button type="button" className="btn" onClick={() => setFilters(NO_FILTERS)}>
                {S.clearFilters}
              </button>
            )}
          </div>
        )}
      </section>
    </Page>
  );
}

