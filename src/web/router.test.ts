import { describe, expect, it } from "vitest";
import { matchPath, normalizePath, parseLocation } from "./router";

describe("router helpers", () => {
  it("normalizes trailing slashes", () => {
    expect(normalizePath("/setup/")).toBe("/setup");
    expect(normalizePath("")).toBe("/");
  });

  it("splits pathname and search and drops the hash", () => {
    expect(parseLocation("/calls?failed=1#top")).toEqual({ pathname: "/calls", search: "?failed=1" });
    expect(parseLocation("/calls/")).toEqual({ pathname: "/calls", search: "" });
    expect(parseLocation("/calls?")).toEqual({ pathname: "/calls", search: "" });
  });

  it("matches path params", () => {
    expect(matchPath("/services/:id", "/services/s3")).toEqual({ id: "s3" });
    expect(matchPath("/services/:id/operations/:op", "/services/s3/operations/Put%20Object")).toEqual({ id: "s3", op: "Put Object" });
    expect(matchPath("/services/:id", "/services")).toBeNull();
    expect(matchPath("/services/:id", "/calls/s3")).toBeNull();
    expect(matchPath("/calls", "/calls/")).toEqual({});
    expect(matchPath("/services/:id", "/services/%E0%A4%A")).toBeNull();
  });
});
