import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmulatorHealth } from "../shared/api.js";
import { createMonitor, stepsFor } from "./monitor.js";

const UP: EmulatorHealth = { reachable: true, port: 9297 };
const DOWN: EmulatorHealth = { reachable: false, port: 9297, reason: "refused" };

let health: EmulatorHealth;
let keys: string | null;
let checks: number;
let checkMs = 0; // how long a check takes

function make(recentMs = 0) {
  return createMonitor({
    recentMs,
    check: async () => {
      checks += 1;
      if (checkMs > 0) await new Promise((r) => setTimeout(r, checkMs));
      return health;
    },
    fingerprint: async () => keys,
    address: "127.0.0.1:9297",
    keysPath: ".aws/emulator/9297/emulator_credentials",
    port: 9297,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-26T14:00:00Z") });
  health = UP;
  keys = "run-1";
  checks = 0;
  checkMs = 0;
});
afterEach(() => vi.useRealTimers());

describe("health monitor timing", () => {
  it("checks at once, then every 30 s while the Emulator answers", async () => {
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(checks).toBe(3);
    m.stop();
  });

  it("checks every 5 s while the Emulator isn't answering, and goes back to 30 s once it does", async () => {
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    health = DOWN;
    await vi.advanceTimersByTimeAsync(30_000); // the check that sees it stopped
    expect(checks).toBe(2);
    expect((await m.current()).reachable).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checks).toBe(3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checks).toBe(4);
    health = UP;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(checks).toBe(5);
    expect((await m.current()).reachable).toBe(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(checks).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks).toBe(6);
    m.stop();
  });

  it("notices a stop within 35 s of the last check", async () => {
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    health = DOWN;
    await vi.advanceTimersByTimeAsync(1_000); // the Emulator stops just after a check
    await vi.advanceTimersByTimeAsync(29_000);
    expect((await m.current()).reachable).toBe(false);
    m.stop();
  });

  it("does not check after stop(), and checkNow() restarts the timer from its result", async () => {
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000);
    await m.checkNow();
    expect(checks).toBe(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(checks).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks).toBe(3);
    m.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checks).toBe(3);
  });

  it("counts the interval from when a check began, so a 3 s check doesn't delay the next", async () => {
    checkMs = 3_000;
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(3_000); // first check ends
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(26_999); // 29.999 s after the first began
    expect(checks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks).toBe(2);
    health = DOWN;
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await m.current()).reachable).toBe(false);
    // Down: 5 s from the start of the check that saw it, which took 3 s.
    const before = checks;
    await vi.advanceTimersByTimeAsync(1_999);
    expect(checks).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(checks).toBe(before + 1);
    m.stop();
  });

  it("notices a stop within 35 s even when each failing check takes 3 s", async () => {
    checkMs = 3_000;
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(3_000);
    health = DOWN;
    await vi.advanceTimersByTimeAsync(1); // stopped just after a check began
    await vi.advanceTimersByTimeAsync(32_000);
    expect((await m.current()).reachable).toBe(false);
    m.stop();
  });

  it("has checkNow join a check that is already running", async () => {
    checkMs = 3_000;
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(10); // the scheduled first check is in flight
    const joined = m.checkNow();
    await vi.advanceTimersByTimeAsync(3_000);
    await joined;
    expect(checks).toBe(1);
    m.stop();
  });

  it("does not re-arm the timer when stop() comes during a check", async () => {
    checkMs = 3_000;
    const m = make();
    m.start();
    await vi.advanceTimersByTimeAsync(10);
    m.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checks).toBe(1);
  });

  it("current() does not check again once there is a result", async () => {
    const m = make();
    await m.current();
    await m.current();
    await m.current();
    expect(checks).toBe(1);
  });

  it("checkNow returns a result under a second old without asking again", async () => {
    const m = make(1_000);
    await m.checkNow();
    vi.setSystemTime(Date.now() + 500);
    await m.checkNow();
    expect(checks).toBe(1);
    vi.setSystemTime(Date.now() + 600);
    await m.checkNow();
    expect(checks).toBe(2);
  });

  it("runs one check for overlapping callers", async () => {
    const m = make();
    await Promise.all([m.current(), m.checkNow(), m.current()]);
    expect(checks).toBe(1);
  });
});

describe("health monitor state", () => {
  it("keeps the last answer time while the Emulator is down", async () => {
    const m = make();
    const first = await m.checkNow();
    expect(first.lastAnswerAt).toBe("2026-11-26T14:00:00.000Z");
    health = DOWN;
    vi.setSystemTime(new Date("2026-11-26T14:01:00Z"));
    const second = await m.checkNow();
    expect(second.reachable).toBe(false);
    expect(second.lastAnswerAt).toBe("2026-11-26T14:00:00.000Z");
    expect(second.checkedAt).toBe("2026-11-26T14:01:00.000Z");
  });

  it("has no last answer time when it never answered", async () => {
    health = DOWN;
    expect((await make().checkNow()).lastAnswerAt).toBeNull();
  });

  it("reports a restart only when the keys change, and keeps it", async () => {
    const m = make();
    expect((await m.checkNow()).restartedAt).toBeNull();
    expect((await m.checkNow()).restartedAt).toBeNull();
    keys = "run-2";
    vi.setSystemTime(new Date("2026-11-26T14:05:00Z"));
    expect((await m.checkNow()).restartedAt).toBe("2026-11-26T14:05:00.000Z");
    vi.setSystemTime(new Date("2026-11-26T14:06:00Z"));
    expect((await m.checkNow()).restartedAt).toBe("2026-11-26T14:05:00.000Z");
  });

  it("does not report a restart for the same keys after an outage, or for missing keys", async () => {
    const m = make();
    await m.checkNow();
    health = DOWN;
    keys = null;
    expect((await m.checkNow()).restartedAt).toBeNull();
    keys = "run-1";
    health = UP;
    expect((await m.checkNow()).restartedAt).toBeNull();
  });

  it("does not report a restart for the first keys it sees", async () => {
    keys = null;
    const m = make();
    await m.checkNow();
    keys = "run-1";
    expect((await m.checkNow()).restartedAt).toBeNull();
  });

  it("never carries the keys or their fingerprint in its state", async () => {
    keys = "super-secret-fingerprint";
    const state = await make().checkNow();
    expect(JSON.stringify(state)).not.toContain("super-secret-fingerprint");
  });

  it("treats a failing check as not answering", async () => {
    const m = createMonitor({
      check: async () => {
        throw new Error("boom");
      },
      fingerprint: async () => null,
      address: "a",
      keysPath: "k",
      port: 9297,
    });
    expect(await m.checkNow()).toMatchObject({ reachable: false, reason: "unreachable" });
  });
});

describe("stepsFor", () => {
  it("maps each reason to the three steps", () => {
    expect(stepsFor(UP, true)).toEqual({ reach: "answered", trust: "trusted", keys: "read" });
    expect(stepsFor(DOWN, false)).toEqual({ reach: "no-answer", trust: "unknown", keys: "missing" });
    expect(stepsFor({ reachable: false, port: 1, reason: "no-ca" }, true)).toEqual({ reach: "answered", trust: "no-ca", keys: "read" });
    expect(stepsFor({ reachable: false, port: 1, reason: "untrusted" }, true)).toEqual({ reach: "answered", trust: "untrusted", keys: "read" });
    expect(stepsFor({ reachable: false, port: 1, reason: "unhealthy" }, true)).toEqual({ reach: "answered", trust: "trusted", keys: "read" });
  });
});

describe("restart listeners", () => {
  it("are told when the keys change, with the detection time, and not for the first keys seen", async () => {
    const m = make();
    const seen: string[] = [];
    const stop = m.onRestart((at) => seen.push(at));
    await m.checkNow();
    expect(seen).toEqual([]);
    keys = "run-2";
    await vi.advanceTimersByTimeAsync(2000);
    await m.checkNow();
    expect(seen).toEqual(["2026-11-26T14:00:02.000Z"]);
    stop();
    keys = "run-3";
    await vi.advanceTimersByTimeAsync(2000);
    await m.checkNow();
    expect(seen).toHaveLength(1);
  });
});
