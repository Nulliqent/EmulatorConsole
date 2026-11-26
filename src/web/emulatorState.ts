import type { EmulatorStatus } from "../shared/api";

/**
 * A3 (the Emulator may have stopped after its idle time) only when nothing is listening at its address.
 * Any other silence, including a running Emulator the Console can't verify, is A1.
 */
export function stoppedCleanly(emulator: Pick<EmulatorStatus, "reason">): boolean {
  return emulator.reason === "refused";
}

/** True when `next` is not older than `current`, by the time of its last check. Used to drop out-of-order replies. */
export function isNewer(next: Pick<EmulatorStatus, "checkedAt">, current: Pick<EmulatorStatus, "checkedAt"> | null): boolean {
  if (!current || current.checkedAt === null) return true;
  if (next.checkedAt === null) return false;
  return next.checkedAt >= current.checkedAt;
}
