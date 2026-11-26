import type { Ref } from "react";
import { Icon, type IconName } from "./icons";
import { Link, useRouter } from "./router";
import { S } from "./strings";

export const NAV: { key: IconName; label: string; to: string; match: (path: string) => boolean }[] = [
  { key: "run", label: "Current run", to: "/run", match: (p) => p === "/" || p === "/run" },
  { key: "calls", label: "Calls", to: "/calls", match: (p) => p.startsWith("/calls") },
  { key: "services", label: "Services", to: "/services", match: (p) => p.startsWith("/services") },
  { key: "markers", label: "Markers", to: "/markers", match: (p) => p.startsWith("/markers") },
  { key: "setup", label: "Setup", to: "/setup", match: (p) => p.startsWith("/setup") },
];

type Props = {
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onHide: () => void;
  hideRef: Ref<HTMLButtonElement>;
  menuRef: Ref<HTMLButtonElement>;
};

export function Sidebar({ menuOpen, onMenu, onHide, hideRef, menuRef }: Props) {
  const { pathname: path } = useRouter();
  return (
    <nav className="side glass" aria-label="Main" id="side" data-open={menuOpen}>
      <div className="brand">
        <b>{S.appName}</b>
        <span>{S.tagline}</span>
      </div>
      <button type="button" className="btn ghost menubtn" ref={menuRef} aria-expanded={menuOpen} aria-controls="nav" onClick={() => onMenu(!menuOpen)}>
        {S.menu}
      </button>
      <button type="button" className="btn ghost hidebtn" ref={hideRef} onClick={onHide}>
        <Icon name="sidebar" />
        <span>{S.hideSidebar}</span>
      </button>
      <div className="nav" id="nav">
        {NAV.map((item) => (
          <Link key={item.key} to={item.to} aria-current={item.match(path) ? "page" : undefined} onClick={() => onMenu(false)}>
            <Icon name={item.key} />
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
      <p className="foot">{S.notAffiliated}</p>
    </nav>
  );
}
