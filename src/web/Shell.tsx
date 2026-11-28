import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FindDialog, IS_MAC, type FindHandle } from "./FindDialog";
import { Notices } from "./Notices";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { focusHeading } from "./focus";
import { useRouter } from "./router";
import { S } from "./strings";
import { readLocal, writeLocal } from "./storage";

const SIDEBAR_KEY = "console.sidebarHidden";

/** The frame on every page: skip link, glass sidebar, toolbar, notices and the page. */
export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => readLocal(SIDEBAR_KEY) === "1");
  const find = useRef<FindHandle>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef<"show" | "hide" | null>(null);
  const lastPath = useRef(pathname);

  // Keyboard map, "Page load": focus goes to the page's h1 after navigating. On the first load focus stays at the
  // top of the page, so the skip link is the first stop.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    focusHeading();
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return;
      if (IS_MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      find.current?.open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Escape closes the open menu (below 640 px) and returns focus to the Menu button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape in an open dialog (Find) closes the dialog only.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      setMenuOpen(false);
      menuRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // "Sidebar hidden: focus goes to the Show sidebar button." Showing it again returns focus to Hide sidebar.
  useEffect(() => {
    if (focusAfterToggle.current === "show") showRef.current?.focus();
    if (focusAfterToggle.current === "hide") hideRef.current?.focus();
    focusAfterToggle.current = null;
  }, [sidebarHidden]);

  const toggleSidebar = useCallback((hidden: boolean) => {
    focusAfterToggle.current = hidden ? "show" : "hide";
    writeLocal(SIDEBAR_KEY, hidden ? "1" : "0");
    setSidebarHidden(hidden);
  }, []);

  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          focusHeading();
        }}
      >
        {S.skip}
      </a>
      <div className="app" data-sidebar={sidebarHidden ? "hidden" : "shown"}>
        {/* Hidden by CSS, so below 640 px (where it is a menu) the navigation is always reachable. */}
        <Sidebar menuOpen={menuOpen} onMenu={setMenuOpen} onHide={() => toggleSidebar(true)} hideRef={hideRef} menuRef={menuRef} />
        <div className="col">
          <Toolbar
            onFind={() => find.current?.open()}
            sidebarHidden={sidebarHidden}
            onShowSidebar={() => toggleSidebar(false)}
            showSidebarRef={showRef}
          />
          <Notices />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <FindDialog ref={find} />
    </>
  );
}
