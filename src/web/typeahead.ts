/** How long typed letters keep adding to one prefix before the next letter starts a new one. */
export const TYPEAHEAD_MS = 700;

/**
 * Letters jump (edge case "436 services in the A-Z list"). With focus on a service link: a letter or digit moves focus
 * to the next shown service whose name starts with it (the same letter again moves on to the next one, and wraps);
 * letters typed within 700 ms of each other make one prefix ("sim" finds "Simple Queue Service"; once a prefix has
 * begun, a space is part of it, so "amazon s" works, but a lone first space does nothing). The arrow keys move
 * one service, Home and End the first and last. In the filter field, letters type as usual and Down Arrow moves to the
 * first service.
 *
 * Given the names shown, the index of the one in focus (-1 for none) and the letters typed so far, returns the index to
 * focus, or null when none starts with them.
 */
export function nextByTypeahead(names: readonly string[], current: number, typed: string): number | null {
  if (names.length === 0 || typed === "") return null;
  const prefix = typed.toLowerCase();
  const repeated = prefix.length > 1 && [...prefix].every((c) => c === prefix[0]);
  const needle = repeated ? prefix[0]! : prefix;
  // One letter, or one letter repeated, moves on from the current service; a longer prefix may keep the current one.
  const start = needle.length === 1 ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < names.length; step++) {
    const i = (start + step) % names.length;
    if (names[i]!.toLowerCase().startsWith(needle)) return i;
  }
  return null;
}
