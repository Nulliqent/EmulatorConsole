export const MAX_QUERY = 100;

/**
 * What the Developer typed, made ready to search: trimmed, runs of whitespace collapsed to one space, then cut to
 * MAX_QUERY characters (never ending in a space). The Console and the server share this one function, so the text
 * Find sends and the text the server answers for are the same string.
 */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY).trimEnd();
}
