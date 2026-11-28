import { describe, expect, it } from "vitest";
import { nextByTypeahead } from "./typeahead";

const names = ["Account", "Amplify", "API Gateway", "Athena", "Budgets", "Simple Queue Service", "Simple Storage Service", "Step Functions"];

describe("letters jump", () => {
  it("moves to the next service that starts with the letter, and wraps", () => {
    expect(nextByTypeahead(names, -1, "b")).toBe(4);
    expect(nextByTypeahead(names, 0, "a")).toBe(1);
    expect(nextByTypeahead(names, 3, "a")).toBe(0);
  });

  it("repeating a letter moves on through the services that start with it", () => {
    expect(nextByTypeahead(names, 5, "s")).toBe(6);
    expect(nextByTypeahead(names, 5, "ss")).toBe(6);
    expect(nextByTypeahead(names, 7, "s")).toBe(5);
  });

  it("a longer prefix narrows, and may stay where it is", () => {
    expect(nextByTypeahead(names, 5, "simple q")).toBe(5);
    expect(nextByTypeahead(names, 5, "simple st")).toBe(6);
    expect(nextByTypeahead(names, 0, "ste")).toBe(7);
  });

  it("ignores case and returns null when nothing starts with the text", () => {
    expect(nextByTypeahead(names, -1, "BUD")).toBe(4);
    expect(nextByTypeahead(names, 0, "z")).toBeNull();
    expect(nextByTypeahead([], 0, "a")).toBeNull();
  });
});
