import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Two live regions that stay in the page, so a screen reader hears a change as speech without any visible UI.
// Politeness follows docs/design/accessibility-emulator-console.md.

type Politeness = "polite" | "assertive";
type Say = (text: string, politeness?: Politeness) => void;
const AnnounceContext = createContext<Say>(() => {});

export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const say = useCallback<Say>((text, politeness = "polite") => {
    const set = politeness === "assertive" ? setAssertive : setPolite;
    set(""); // clear first, so the same sentence twice is spoken twice
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      set(text);
    }, 50);
    timers.current.add(id);
  }, []);

  return (
    <AnnounceContext.Provider value={say}>
      {children}
      <div className="sr" role="status" aria-live="polite" data-testid="live-polite">{polite}</div>
      <div className="sr" role="alert" aria-live="assertive" data-testid="live-assertive">{assertive}</div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): Say {
  return useContext(AnnounceContext);
}
