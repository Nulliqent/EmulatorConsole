import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// A small history-API router. The server answers every non-/assets/ path with index.html, so real paths work.
// Routes match on the pathname; the search string rides along for pages that use query parameters.

type Location = { pathname: string; search: string };
type RouterValue = Location & { navigate: (to: string, options?: { replace?: boolean }) => void };
const RouterContext = createContext<RouterValue>({ pathname: "/", search: "", navigate: () => {} });

export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Splits "/a/b?x=1#h" into a normalized pathname and a search string ("?x=1", or ""). The hash is dropped. */
export function parseLocation(to: string): Location {
  const [beforeHash = ""] = to.split("#");
  const q = beforeHash.indexOf("?");
  const pathname = normalizePath(q === -1 ? beforeHash : beforeHash.slice(0, q));
  const search = q === -1 ? "" : beforeHash.slice(q);
  return { pathname, search: search === "?" ? "" : search };
}

/**
 * Matches a pathname against a pattern with ":name" segments and returns the params, or null.
 * matchPath("/services/:id", "/services/s3") gives { id: "s3" }. Segments are URL-decoded.
 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const want = normalizePath(pattern).split("/");
  const have = normalizePath(pathname).split("/");
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    const h = have[i]!;
    if (w.startsWith(":")) {
      try {
        params[w.slice(1)] = decodeURIComponent(h);
      } catch {
        return null;
      }
    } else if (w !== h) return null;
  }
  return params;
}

function current(): Location {
  return parseLocation(window.location.pathname + window.location.search);
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(current);

  useEffect(() => {
    const onPop = () => setLocation(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const next = parseLocation(to);
    const url = next.pathname + next.search;
    if (url !== window.location.pathname + window.location.search) {
      window.history[options?.replace ? "replaceState" : "pushState"](null, "", url);
    }
    setLocation(next);
  }, []);

  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={handle} />;
}
