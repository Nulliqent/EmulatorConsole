import { AnnounceProvider } from "./announce";
import { Shell } from "./Shell";
import { RouterProvider, useRouter } from "./router";
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
      return <Placeholder title="Services" />;
    case "/markers":
      return <Placeholder title="Markers" />;
    case "/setup":
      return <Connection />;
    case "/setup/gateway":
      return <Gateway />;
    default:
      return (
        <Page title={S.notFoundTitle}>
          <p className="muted">{S.notFoundText}</p>
        </Page>
      );
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
