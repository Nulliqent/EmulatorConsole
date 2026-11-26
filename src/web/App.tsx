import { useEffect, useState } from "react";
import type { EmulatorReason, HealthResponse } from "../shared/api";

// Sentences from docs/design/copy-emulator-console.md where they exist. The reason code stays in a
// data attribute for debugging and is never shown.
const REASON_TEXT: Record<EmulatorReason, string> = {
  "no-ca": "The Emulator isn't answering. It may have stopped after a period with no API calls.",
  unreachable: "The Emulator isn't answering.",
  unhealthy: "The Emulator answered, but did not report that it is healthy.",
};

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<HealthResponse>) : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  const emulator = health?.emulator;
  return (
    <main className="shell">
      <h1>Emulator Console</h1>
      <p className="muted">For AWS Emulator. Not affiliated with AWS.</p>
      <section className="panel" aria-live="polite">
        {failed ? (
          <p className="status down">The Console isn't answering. Check that it is running.</p>
        ) : !emulator ? (
          <p className="muted">Checking the Emulator.</p>
        ) : emulator.reachable ? (
          <p className="status">
            Connected to the Emulator on port <span className="mono">{emulator.port}</span>.
          </p>
        ) : (
          <>
            <p className="status down" data-reason={emulator.reason}>
              {REASON_TEXT[emulator.reason ?? "unreachable"]}
            </p>
            <p className="muted">Restart it with <span className="mono">docker compose restart</span>.</p>
          </>
        )}
      </section>
    </main>
  );
}
