import { AnnounceProvider } from "./announce";
import { Shell } from "./Shell";
import { RouterProvider, matchPath, useRouter } from "./router";
import { ServiceFrame } from "./pages/Service";
import { Services } from "./pages/Services";
import { StatusProvider } from "./status";
import { Page, Placeholder } from "./pages/Page";
import { Connection, Gateway } from "./pages/Setup";
import { S } from "./strings";

function Routes() {
  const { pathname: path } = useRouter();
  switch (path) {
    case "/":
    case "/run":
      return <Placeholder title="Current run" />;
    case "/calls":
      return <Placeholder title="Calls" />;
    case "/services":
      return <Services />;
    case "/markers":
      return <Placeholder title="Markers" />;
    case "/setup":
      return <Connection />;
    case "/setup/gateway":
      return <Gateway />;
    default: {
      const service = matchPath("/services/:slug", path);
      if (service) return <ServiceFrame slug={service.slug!} tab="resources" />;
      const ops = matchPath("/services/:slug/ops", path);
      if (ops) return <ServiceFrame slug={ops.slug!} tab="operations" />;
      const calls = matchPath("/services/:slug/calls", path);
      if (calls) return <ServiceFrame slug={calls.slug!} tab="calls" />;
      const op = matchPath("/services/:slug/ops/:op", path);
      if (op) return <ServiceFrame slug={op.slug!} tab="operations" op={op.op} />;
      return (
        <Page title={S.notFoundTitle}>
          <p className="muted">{S.notFoundText}</p>
        </Page>
      );
    }
  }
}

export function App() {
  return (
    <RouterProvider>
      <AnnounceProvider>
        <StatusProvider>
          <Shell>
            <Routes />
          </Shell>
        </StatusProvider>
      </AnnounceProvider>
    </RouterProvider>
  );
}
