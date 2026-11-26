// Types for the Console's API, imported by both the server and the UI. Types only, no runtime code.

/** Why the Console could not confirm the Emulator is up. Codes are for debugging, not for display. */
export type EmulatorReason = "no-ca" | "unreachable" | "unhealthy";

export type EmulatorHealth = {
  reachable: boolean;
  port: number;
  reason?: EmulatorReason;
};

/** GET /api/health */
export type HealthResponse = { emulator: EmulatorHealth };
