const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"];

/** The Host values the Console answers to: a loopback name with the Console's own port. */
export function allowedHosts(port: number): Set<string> {
  return new Set(LOOPBACK_NAMES.map((name) => `${name}:${port}`));
}

export type Refusal = { status: number; message: string };

/**
 * Refuses a request whose Host is not a loopback name with the Console's port (DNS rebinding),
 * or whose Origin is present and is not the Console's own (cross-site requests).
 */
export function checkRequest(
  headers: { host?: string; origin?: string },
  port: number,
): Refusal | null {
  const hosts = allowedHosts(port);
  const host = headers.host?.toLowerCase();
  if (host === undefined || !hosts.has(host)) {
    return { status: 421, message: "Host not allowed" };
  }
  const origin = headers.origin;
  if (origin !== undefined) {
    // Opaque origins arrive as the string "null"; they are never the Console's own.
    const own = [...hosts].map((h) => `http://${h}`);
    if (!own.includes(origin.toLowerCase())) {
      return { status: 403, message: "Origin not allowed" };
    }
  }
  return null;
}

/**
 * Refuses an API request a browser says came from another site. `Sec-Fetch-Site` is set by browsers and cannot be
 * changed by page script: `same-origin` (the Console's own pages) and `none` (typed or bookmarked) pass, and so does a
 * request without the header (curl, tests, older browsers). `cross-site` is refused, and so is `same-site`: another
 * port on localhost is the same site but not the Console.
 */
export function checkFetchSite(headers: { "sec-fetch-site"?: string | string[] }): Refusal | null {
  const site = headers["sec-fetch-site"];
  if (site === undefined || site === "same-origin" || site === "none") return null;
  return { status: 403, message: "Cross-site request not allowed" };
}
