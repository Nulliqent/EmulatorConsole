import { describe, expect, it } from "vitest";
import { isNewer, stoppedCleanly } from "./emulatorState";

describe("stoppedCleanly", () => {
  it("is A3 only when nothing is listening", () => {
    expect(stoppedCleanly({ reason: "refused" })).toBe(true);
  });

  it.each(["no-ca", "untrusted", "unreachable", "unhealthy", undefined] as const)("is A1 for %s", (reason) => {
    expect(stoppedCleanly({ reason })).toBe(false);
  });
});

describe("isNewer (status ordering)", () => {
  const at = (checkedAt: string | null) => ({ checkedAt });
  it("takes the first result", () => {
    expect(isNewer(at("2026-11-26T14:00:00Z"), null)).toBe(true);
    expect(isNewer(at("2026-11-26T14:00:00Z"), at(null))).toBe(true);
  });
  it("takes a later or equal one and drops an earlier one", () => {
    expect(isNewer(at("2026-11-26T14:00:05Z"), at("2026-11-26T14:00:00Z"))).toBe(true);
    expect(isNewer(at("2026-11-26T14:00:00Z"), at("2026-11-26T14:00:00Z"))).toBe(true);
    expect(isNewer(at("2026-11-26T14:00:00Z"), at("2026-11-26T14:00:05Z"))).toBe(false);
    expect(isNewer(at(null), at("2026-11-26T14:00:00Z"))).toBe(false);
  });
});
