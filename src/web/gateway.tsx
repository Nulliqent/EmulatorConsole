import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayStatus } from "../shared/calls";
import { useAnnounce } from "./announce";
import { formatTime } from "./format";
import { S } from "./strings";

/** How often the Gateway page reads the Gateway's state while it is open. */
export const GATEWAY_POLL_MS = 2000;

/** The sentence for the Gateway's first Call: the operation, or the request when it isn't one the Console knows. */
export function firstCallText(first: NonNullable<GatewayStatus["firstCall"]>): string {
  return S.firstCall(first.operation ?? `${first.method} ${first.path}`, formatTime(first.startedAt));
}

/**
 * Reads `/api/gateway` now and every two seconds, so a Call that arrives shows without a reload. `status` is null
 * until the first answer, and `failed` is true when the Console did not answer the last read.
 */
export function useGatewayStatus() {
  const say = useAnnounce();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const sawFirst = useRef<boolean | null>(null);
  const saving = useRef(0); // while a change is being saved, a read that started before it must not undo it
  const generation = useRef(0); // counts changes, so a read that began before one is dropped

  const apply = useCallback(
    (next: GatewayStatus) => {
      setStatus(next);
      setFailed(false);
      const has = next.firstCall !== null;
      // Said once, when the first Call arrives while the page is open.
      if (sawFirst.current === false && has) say(firstCallText(next.firstCall!));
      sawFirst.current = has;
    },
    [say],
  );

  useEffect(() => {
    let live = true;
    const read = () => {
      const started = generation.current;
      return fetch("/api/gateway", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<GatewayStatus>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (next) => live && saving.current === 0 && generation.current === started && apply(next),
          () => live && setFailed(true),
        );
    };
    void read();
    // Nothing is read while the tab is hidden, and the page reads at once when it is shown again.
    let id: number | undefined;
    const start = () => {
      if (id === undefined && !document.hidden) id = window.setInterval(read, GATEWAY_POLL_MS);
    };
    const stop = () => {
      window.clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void read();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apply]);

  /** Sets "Record headers and status only". */
  const setHeadersOnly = useCallback(
    async (headersOnly: boolean) => {
      saving.current++;
      generation.current++;
      setSaveFailed(false);
      setStatus((s) => (s ? { ...s, headersOnly } : s));
      try {
        const res = await fetch("/api/gateway/settings", {
          method: "POST",
          headers: { "content-type": "application/json", "x-console": "1" },
          body: JSON.stringify({ headersOnly }),
        });
        if (!res.ok) throw new Error(String(res.status));
        apply((await res.json()) as GatewayStatus);
      } catch {
        // The Console didn't take it: the box goes back to what it was, and the page says so.
        setStatus((s) => (s ? { ...s, headersOnly: !headersOnly } : s));
        setSaveFailed(true);
        say(S.settingFailed, "assertive");
      } finally {
        generation.current++;
        saving.current--;
      }
    },
    [apply, say],
  );

  return { status, failed, saveFailed, setHeadersOnly };
}
