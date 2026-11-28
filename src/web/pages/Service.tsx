import { Link } from "../router";
import { S } from "../strings";
import { useServiceIndex } from "../serviceIndex";
import { Page } from "./Page";

type Tab = "resources" | "operations" | "calls";

function ServiceTabs({ slug, title, current }: { slug: string; title: string; current: Tab | null }) {
  const tabs: [Tab, string, string][] = [
    ["resources", S.tabResources, `/services/${encodeURIComponent(slug)}`],
    ["operations", S.tabOperations, `/services/${encodeURIComponent(slug)}/ops`],
    ["calls", S.tabCalls, `/services/${encodeURIComponent(slug)}/calls`],
  ];
  return (
    <nav className="tabs glass" aria-label={title}>
      {tabs.map(([key, label, to]) => (
        <Link key={key} to={to} aria-current={current === key ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Crumbs({ title }: { title: string }) {
  return (
    <p className="crumbs">
      <Link to="/services">{S.crumbServices}</Link> / {title}
    </p>
  );
}

/**
 * A service's page, so far a frame: the title and the tabs. Resources arrives with ticket #7, Operations and the
 * operation form with #8, Calls with #10. `op` is set on /services/<slug>/ops/<Operation>.
 * The h1 is rendered from the first paint (the slug until the index is read), so focus can move to it on arrival.
 */
export function ServiceFrame({ slug, tab, op }: { slug: string; tab: Tab; op?: string }) {
  const index = useServiceIndex();
  const service = index.status === "ready" ? index.services.find((s) => s.slug === slug) : undefined;
  if (index.status === "ready" && !service) {
    return (
      <Page title={S.serviceNotFoundTitle}>
        <p className="muted">{S.serviceNotFoundText(slug)}</p>
        <p>
          <Link to="/services">{S.findBrowse}</Link>
        </p>
      </Page>
    );
  }
  const title = service?.title ?? slug;
  return (
    <Page title={op ?? title} sub={op ? title : service?.sdkId}>
      <Crumbs title={title} />
      <ServiceTabs slug={slug} title={title} current={op ? "operations" : tab} />
      <p className="muted">{S.placeholder}</p>
    </Page>
  );
}
