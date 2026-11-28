import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CURATED_SDK_IDS, isCurated } from "./curated.js";
import type { ModelIndexFile } from "../server/model-index/types.js";
import type { ServiceSummary } from "./models.js";
import { allImplemented, filterServices, hasResourceLists, NO_FILTERS, resourcesState, sortByTitle } from "./services.js";

let all: ServiceSummary[];
beforeAll(() => {
  const file = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "data", "model-index", "index.json"), "utf8")) as ModelIndexFile;
  all = sortByTitle(file.services);
});

const ids = (list: ServiceSummary[]) => list.map((s) => s.sdkId);

describe("the Services page filters", () => {
  it("defines the eight Curated Services in one place, all present in the index", () => {
    expect(CURATED_SDK_IDS).toHaveLength(8);
    expect(filterServices(all, { ...NO_FILTERS, curated: true }).map((s) => s.sdkId).sort()).toEqual([...CURATED_SDK_IDS].sort());
    expect(isCurated("S3")).toBe(true);
    expect(isCurated("EC2")).toBe(false);
  });

  it("shows all 436 with no filter, sorted A to Z by title", () => {
    expect(filterServices(all, NO_FILTERS)).toHaveLength(436);
    const titles = all.map((s) => s.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  it("matches text against the title, the SDK ID and the slug, ignoring case and spaces", () => {
    expect(ids(filterServices(all, { ...NO_FILTERS, text: "dynamo" }))).toContain("DynamoDB");
    expect(ids(filterServices(all, { ...NO_FILTERS, text: "SECRETS MANAGER" }))).toEqual(["Secrets Manager"]);
    expect(ids(filterServices(all, { ...NO_FILTERS, text: "secrets-manager" }))).toEqual(["Secrets Manager"]);
    expect(ids(filterServices(all, { ...NO_FILTERS, text: "  cloudwatch  logs " }))).toContain("CloudWatch Logs");
    expect(filterServices(all, { ...NO_FILTERS, text: "zzzz" })).toEqual([]);
  });

  it("'Has resource lists' tests listOperations, not listClass", () => {
    const withLists = filterServices(all, { ...NO_FILTERS, lists: true });
    expect(withLists.every((s) => s.listOperations.length > 0)).toBe(true);
    // Services the model classes as `list` but the Emulator implements no list for are not "Listed".
    const classedListButNone = all.filter((s) => s.listClass === "list" && s.listOperations.length === 0);
    expect(classedListButNone.length).toBeGreaterThan(0);
    for (const s of classedListButNone) {
      expect(hasResourceLists(s)).toBe(false);
      expect(withLists).not.toContain(s);
      expect(resourcesState(s)).not.toBe("listed");
    }
    expect(withLists).toHaveLength(all.filter((s) => s.listOperations.length > 0).length);
  });

  it("'Everything implemented' keeps services with no stubbed or missing operation", () => {
    const done = filterServices(all, { ...NO_FILTERS, implemented: true });
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((s) => s.notImplemented === 0 && s.notInEmulator === 0)).toBe(true);
    expect(allImplemented(all.find((s) => s.sdkId === "EC2")!)).toBe(false);
  });

  it("combines filters with AND", () => {
    const both = filterServices(all, { text: "s", curated: true, lists: true, implemented: false });
    expect(both.every((s) => isCurated(s.sdkId) && s.listOperations.length > 0)).toBe(true);
    expect(filterServices(all, { text: "lambda", curated: true, lists: false, implemented: false }).map((s) => s.sdkId)).toEqual(["Lambda"]);
  });

  it("names the Resources column from the data", () => {
    expect(resourcesState(all.find((s) => s.sdkId === "DynamoDB")!)).toBe("listed");
    // A Get or Search that lists without input is its own state, not Listed (API Gateway implements no List or Describe).
    const apiGateway = all.find((s) => s.sdkId === "API Gateway")!;
    expect(apiGateway.listOperations).toEqual([]);
    expect(resourcesState(apiGateway)).toBe("get-or-search");
    // Budgets' lists all need an AccountId.
    const budgets = all.find((s) => s.sdkId === "Budgets")!;
    expect(budgets.inputListOperations).toContain("DescribeBudgets");
    expect(resourcesState(budgets)).toBe("needs-input");
    expect(resourcesState({ ...budgets, inputListOperations: [] })).toBe("none");
    const states = new Set(all.map(resourcesState));
    expect(states).toEqual(new Set(["listed", "get-or-search", "needs-input", "none"]));
    // Services the model classes as list but the Emulator implements no list for must not pass the filter (#3 review).
    for (const sdkId of ["Resource Groups Tagging API", "FraudDetector", "XRay"]) {
      expect(hasResourceLists(all.find((s) => s.sdkId === sdkId)!)).toBe(false);
    }
  });
});
