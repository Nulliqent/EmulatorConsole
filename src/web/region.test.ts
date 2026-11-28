// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REGION, REGION_KEY, getRegion, parseRegion, resetRegionMemory, setRegion } from "./region";

beforeEach(() => {
  window.localStorage.clear();
  resetRegionMemory();
});

describe("parseRegion", () => {
  it("keeps anything that looks like a Region", () => {
    expect(parseRegion("eu-west-1")).toBe("eu-west-1");
    expect(parseRegion("ap-southeast-2")).toBe("ap-southeast-2");
    expect(parseRegion("us-gov-west-1")).toBe("us-gov-west-1");
  });

  it("falls back to the default for null and for junk", () => {
    expect(parseRegion(null)).toBe(DEFAULT_REGION);
    expect(parseRegion("")).toBe(DEFAULT_REGION);
    expect(parseRegion("<script>")).toBe(DEFAULT_REGION);
    expect(parseRegion("us-east")).toBe(DEFAULT_REGION);
  });
});

describe("the active Region", () => {
  it("is the default with nothing stored, and the stored value otherwise", () => {
    expect(getRegion()).toBe(DEFAULT_REGION);
    window.localStorage.setItem(REGION_KEY, "eu-west-1");
    expect(getRegion()).toBe("eu-west-1");
  });

  it("ignores a stored value that isn't a Region", () => {
    window.localStorage.setItem(REGION_KEY, "nonsense");
    expect(getRegion()).toBe(DEFAULT_REGION);
  });

  it("is kept by setRegion for later reads, in storage and in memory", () => {
    setRegion("eu-west-1");
    expect(window.localStorage.getItem(REGION_KEY)).toBe("eu-west-1");
    expect(getRegion()).toBe("eu-west-1");
  });

  it("still applies when storage refuses the write", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      setRegion("eu-west-1");
      expect(getRegion()).toBe("eu-west-1");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("refuses to set something that isn't a Region", () => {
    setRegion("<script>");
    expect(getRegion()).toBe(DEFAULT_REGION);
  });
});
