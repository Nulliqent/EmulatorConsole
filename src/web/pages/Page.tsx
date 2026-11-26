import { useEffect, type ReactNode } from "react";
import { S } from "../strings";

/** A page's frame: its one h1 (focused on navigation, so it takes tabIndex -1) and the tab title. */
export function Page({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${S.appName}`;
  }, [title]);
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Placeholder({ title }: { title: string }) {
  return (
    <Page title={title}>
      <p className="muted">{S.placeholder}</p>
    </Page>
  );
}
