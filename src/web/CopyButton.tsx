import { useEffect, useRef, useState } from "react";
import { useAnnounce } from "./announce";
import { Icon } from "./icons";
import { S } from "./strings";

/** State A9. The label becomes "Copied" for 2 s; if the clipboard refuses, the sentence says what to do. */
export function CopyButton({ text, label, ariaLabel, className = "btn" }: { text: string; label: string; ariaLabel?: string; className?: string }) {
  const say = useAnnounce();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      say(S.copied);
      timer.current = window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      say(S.copyFailed);
      timer.current = window.setTimeout(() => setState("idle"), 8000);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={copy} aria-label={state === "copied" ? undefined : ariaLabel}>
        <Icon name="copy" />
        {state === "copied" ? S.copied : label}
      </button>
      {state === "failed" && <span className="copy-failed" data-testid="copy-failed">{S.copyFailed}</span>}
    </>
  );
}
