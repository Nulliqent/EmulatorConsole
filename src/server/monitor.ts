import type { ConnectionSteps, EmulatorHealth, EmulatorStatus } from "../shared/api.js";
import type { Config } from "./config.js";
import { checkEmulatorHealth } from "./emulator.js";
import { keysDisplayPath, readKeysFingerprint } from "./keys.js";

export const HEALTHY_INTERVAL_MS = 30_000;
export const DOWN_INTERVAL_MS = 5_000;
export const RECENT_MS = 1_000;

export type MonitorDeps = {
  /** One health check. Not an AWS call. */
  check: () => Promise<EmulatorHealth>;
  /** A fingerprint of the run's keys, or null when there are none. Compared, never exposed. */
  fingerprint: () => Promise<string | null>;
  now?: () => Date;
  healthyIntervalMs?: number;
  downIntervalMs?: number;
  /** checkNow() returns the cached result when the last check finished less than this long ago. */
  recentMs?: number;
  address: string;
  keysPath: string;
  port: number;
};

export type Monitor = {
  /** Starts checking: now, then every 30 s while the Emulator answers and every 5 s while it doesn't. */
  start(): void;
  stop(): void;
  /** The latest result. Runs the first check if none has finished yet. */
  current(): Promise<EmulatorStatus>;
  /** Checks now (or returns a result under a second old) and restarts the timer from it. */
  checkNow(): Promise<EmulatorStatus>;
};

export function stepsFor(health: EmulatorHealth, hasKeys: boolean): ConnectionSteps {
  const reason = health.reason;
  return {
    reach: health.reachable || reason === "unhealthy" || reason === "untrusted" || reason === "no-ca" ? "answered" : "no-answer",
    trust: health.reachable || reason === "unhealthy" ? "trusted" : reason === "untrusted" ? "untrusted" : reason === "no-ca" ? "no-ca" : "unknown",
    keys: hasKeys ? "read" : "missing",
  };
}

export function createMonitor(deps: MonitorDeps): Monitor {
  const now = deps.now ?? (() => new Date());
  const healthyMs = deps.healthyIntervalMs ?? HEALTHY_INTERVAL_MS;
  const downMs = deps.downIntervalMs ?? DOWN_INTERVAL_MS;
  const recentMs = deps.recentMs ?? RECENT_MS;

  let state: EmulatorStatus = {
    reachable: false,
    port: deps.port,
    address: deps.address,
    keysPath: deps.keysPath,
    steps: { reach: "unknown", trust: "unknown", keys: "missing" },
    checkedAt: null,
    lastAnswerAt: null,
    restartedAt: null,
  };
  let known: string | null = null; // the last keys fingerprint seen
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let inflight: Promise<EmulatorStatus> | null = null;
  let lastStart = 0; // when the latest check began

  function run(): Promise<EmulatorStatus> {
    inflight ??= (async () => {
      lastStart = now().getTime();
      try {
        const [health, fingerprint] = await Promise.all([
          deps.check().catch((): EmulatorHealth => ({ reachable: false, port: deps.port, reason: "unreachable" })),
          deps.fingerprint().catch(() => null),
        ]);
        const at = now().toISOString();
        // New keys mean a new run. A missing file says nothing, and the first file seen is the baseline.
        const restarted = fingerprint !== null && known !== null && fingerprint !== known;
        if (fingerprint !== null) known = fingerprint;
        state = {
          ...state,
          reachable: health.reachable,
          reason: health.reason,
          steps: stepsFor(health, fingerprint !== null),
          checkedAt: at,
          lastAnswerAt: health.reachable ? at : state.lastAnswerAt,
          restartedAt: restarted ? at : state.restartedAt,
        };
        return state;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    // Counted from when the last check began, so a slow check doesn't push the next one later.
    const interval = state.reachable ? healthyMs : downMs;
    const wait = Math.max(0, interval - (now().getTime() - lastStart));
    timer = setTimeout(() => void run().then(schedule), wait);
  }

  return {
    start() {
      if (running) return;
      running = true;
      void run().then(schedule);
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    async current() {
      return state.checkedAt === null ? run() : state;
    },
    async checkNow() {
      if (!inflight && state.checkedAt !== null && now().getTime() - new Date(state.checkedAt).getTime() < recentMs) {
        return state;
      }
      const result = await run();
      schedule();
      return result;
    },
  };
}

export function createMonitorFor(config: Config): Monitor {
  return createMonitor({
    check: () => checkEmulatorHealth(config),
    fingerprint: () => readKeysFingerprint(config),
    address: config.emulatorDisplayAddress ?? `${config.emulatorHost}:${config.emulatorPort}`,
    keysPath: keysDisplayPath(config),
    port: config.emulatorPort,
  });
}
