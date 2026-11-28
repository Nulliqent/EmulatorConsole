// Types for the Console's API, imported by both the server and the UI. Types only, no runtime code.

/**
 * Why the Console could not confirm the Emulator is up. Codes are for debugging, not for display.
 * - no-ca: this run's ca.pem is not there
 * - refused: nothing is listening (the process is gone, or its name no longer resolves)
 * - untrusted: it answered, but its certificate does not chain to ca.pem
 * - unreachable: no answer in time, or the connection broke
 * - unhealthy: it answered, but not with 200
 */
export type EmulatorReason = "no-ca" | "refused" | "untrusted" | "unreachable" | "unhealthy";

/** The result of one health check. */
export type EmulatorHealth = {
  reachable: boolean;
  port: number;
  reason?: EmulatorReason;
};

/** The three steps the Connection page reports. */
export type ConnectionSteps = {
  reach: "answered" | "no-answer" | "unknown";
  trust: "trusted" | "untrusted" | "no-ca" | "unknown";
  keys: "read" | "missing";
};

/**
 * What the Console knows about the Emulator, kept by the server's health monitor.
 * Times are ISO strings. `restartedAt` is set when the run's keys changed; the keys themselves
 * (and anything derived from them) never leave the server.
 */
export type EmulatorStatus = EmulatorHealth & {
  /** Where the Developer reaches the Emulator, for display. */
  address: string;
  /** Where the run's keys are, for display. */
  keysPath: string;
  steps: ConnectionSteps;
  checkedAt: string | null;
  lastAnswerAt: string | null;
  restartedAt: string | null;
};

/** GET /api/health (the monitor's latest result) and POST /api/health/check (checks now). */
export type HealthResponse = { emulator: EmulatorStatus };
