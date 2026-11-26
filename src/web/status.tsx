import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EmulatorStatus, HealthResponse } from "../shared/api";
import { useAnnounce } from "./announce";
import { isNewer } from "./emulatorState";
import { S } from "./strings";
import { readSession, writeSession } from "./storage";

/** How often the page reads the server's latest result. The server's own checks run every 30 s, or 5 s while down. */
export const POLL_MS = 2000;
const DISMISSED_KEY = "console.dismissedRestart";

type StatusValue = {
  /** null until the first answer from the Console. */
  emulator: EmulatorStatus | null;
  /** True when the Console itself didn't answer the last read. */
  consoleDown: boolean;
  /** Asks the Console to check the Emulator now. */
  checkNow: () => Promise<void>;
  /** The restart notice is showing: a restart was seen and not dismissed in this session. */
  restartVisible: boolean;
  dismissRestart: () => void;
};

const StatusContext = createContext<StatusValue | null>(null);

async function load(post = false): Promise<EmulatorStatus> {
  // A POST must say it comes from the Console's own page (the server refuses it otherwise).
  const res = await fetch(post ? "/api/health/check" : "/api/health", {
    cache: "no-store",
    ...(post ? { method: "POST", headers: { "x-console": "1" } } : {}),
  });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as HealthResponse).emulator;
}

export function StatusProvider({ children }: { children: ReactNode }) {
  const say = useAnnounce();
  const [emulator, setEmulator] = useState<EmulatorStatus | null>(null);
  const [consoleDown, setConsoleDown] = useState(false);
  const [dismissed, setDismissed] = useState(() => readSession(DISMISSED_KEY));
  const previous = useRef<EmulatorStatus | null>(null);

  const apply = useCallback(
    (next: EmulatorStatus) => {
      const before = previous.current;
      // A reply that finished out of order, or says nothing new, changes nothing.
      if (!isNewer(next, before) || JSON.stringify(next) === JSON.stringify(before)) {
        setConsoleDown(false);
        return;
      }
      previous.current = next;
      setEmulator(next);
      setConsoleDown(false);
      if (!before) {
        if (!next.reachable) say(S.announceDown, "assertive");
        return;
      }
      if (before.reachable && !next.reachable) say(S.announceDown, "assertive");
      else if (!before.reachable && next.reachable) say(S.announceUp);
      if (next.restartedAt && next.restartedAt !== before.restartedAt) say(S.announceRestarted, "assertive");
    },
    [say],
  );

  useEffect(() => {
    let live = true;
    let reading = false; // skip a tick while the last read is still out
    const read = () => {
      if (reading) return Promise.resolve();
      reading = true;
      return load()
        .then(
          (next) => live && apply(next),
          () => live && setConsoleDown(true),
        )
        .finally(() => {
          reading = false;
        });
    };
    void read();
    const id = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [apply]);

  const checkNow = useCallback(async () => {
    try {
      apply(await load(true));
    } catch {
      setConsoleDown(true);
    }
  }, [apply]);

  const dismissRestart = useCallback(() => {
    const at = previous.current?.restartedAt;
    if (!at) return;
    writeSession(DISMISSED_KEY, at);
    setDismissed(at);
  }, []);

  const value = useMemo<StatusValue>(
    () => ({
      emulator,
      consoleDown,
      checkNow,
      restartVisible: Boolean(emulator?.restartedAt) && emulator?.restartedAt !== dismissed,
      dismissRestart,
    }),
    [emulator, consoleDown, checkNow, dismissed, dismissRestart],
  );
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus(): StatusValue {
  const value = useContext(StatusContext);
  if (!value) throw new Error("useStatus outside StatusProvider");
  return value;
}
