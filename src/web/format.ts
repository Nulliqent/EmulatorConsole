const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Local 24-hour time with seconds, "14:05:31". The copy deck's format for times in lists and notices. */
export function formatTime(iso: string): string {
  return clock.format(new Date(iso));
}
