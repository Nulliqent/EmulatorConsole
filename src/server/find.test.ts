import { beforeAll, describe, expect, it } from "vitest";
import { normalizeQuery } from "../shared/query.js";
import { find, matchRank, MAX_OPERATIONS, MAX_SERVICES } from "./find.js";
import { loadConfig } from "./config.js";
import { ModelIndex } from "./model-index/index.js";

let index: ModelIndex;
beforeAll(async () => {
  index = await ModelIndex.load(loadConfig({}).modelIndexDir);
});

describe("matchRank", () => {
  it("ranks whole text, start, word start, then anywhere", () => {
    expect(matchRank("S3", "s3")).toBe(0);
    expect(matchRank("ListBuckets", "list")).toBe(1);
    expect(matchRank("ListBuckets", "buckets")).toBe(2); // a CamelCase word
    expect(matchRank("Amazon Simple Queue Service", "queue")).toBe(2);
    expect(matchRank("ListBuckets", "uckets")).toBe(3);
    expect(matchRank("ListBuckets", "zzz")).toBeNull();
    expect(matchRank("ListBuckets", "")).toBeNull();
    // Lower-casing "İ" lengthens the string; positions must still line up with the original.
    expect(matchRank("İİİ Bucket", "bucket")).toBe(2);
  });
});

describe("normalizeQuery", () => {
  it("trims, collapses spaces and cuts to 100 characters", () => {
    expect(normalizeQuery("  list   buckets ")).toBe("list buckets");
    expect(normalizeQuery("a".repeat(500))).toHaveLength(100);
    // Trimmed before it is cut, so leading spaces do not eat the budget; a cut never ends in a space.
    expect(normalizeQuery(" ".repeat(150) + "abc")).toBe("abc");
    expect(normalizeQuery("a".repeat(99) + " b")).toBe("a".repeat(99));
  });
});

describe("find", () => {
  it("answers an empty query with the eight Curated Services", async () => {
    const r = await find(index, "  ");
    expect(r.services.map((s) => s.sdkId)).toEqual(["S3", "DynamoDB", "SQS", "SNS", "Lambda", "CloudWatch Logs", "EventBridge", "IAM"]);
    expect(r.operations).toEqual([]);
  });

  it("ranks an exact SDK ID first, and a Curated Service ahead of others at the same rank", async () => {
    const r = await find(index, "s3");
    expect(r.services[0]).toMatchObject({ sdkId: "S3", slug: "s3" });
    const queue = await find(index, "queue");
    expect(queue.services.map((s) => s.sdkId)).toContain("SQS");
  });

  it("finds operations by name, ignoring typed spaces, with the service and the label", async () => {
    const r = await find(index, "list buckets");
    expect(r.operations[0]).toMatchObject({ name: "ListBuckets", implementation: "implemented", service: { sdkId: "S3", title: expect.any(String) } });
  });

  it("carries the not-implemented label of an operation the Emulator stubs", async () => {
    const stubbed = index.services().find((s) => s.notImplemented > 0)!;
    const detail = await index.detail(stubbed.sdkId);
    const op = detail!.operations.find((o) => o.implementation === "not-implemented")!;
    const r = await find(index, op.name);
    expect(r.operations.find((o) => o.name === op.name && o.service.sdkId === stubbed.sdkId)?.implementation).toBe("not-implemented");
  });

  it("caps both lists and counts what the cap left out", async () => {
    const r = await find(index, "a");
    expect(r.services).toHaveLength(MAX_SERVICES);
    expect(r.operations).toHaveLength(MAX_OPERATIONS);
    expect(r.moreServices).toBeGreaterThan(0);
    expect(r.moreOperations).toBeGreaterThan(0);
  });

  it("puts better matches first: exact name, then prefix, then implemented before stubbed", async () => {
    const r = await find(index, "ListBuckets");
    expect(r.operations[0]!.name).toBe("ListBuckets");
    const ranks = r.operations.map((o) => matchRank(o.name, "listbuckets"));
    expect(ranks).toEqual([...ranks].sort((a, b) => a! - b!));
  });

  it("names a Service Model the Emulator does not offer, instead of finding it", async () => {
    const r = await find(index, "OpenSearch Memory");
    expect(r.services.find((s) => s.sdkId === "OpenSearchMemory")).toBeUndefined();
    expect(r.notOffered).toEqual(["Amazon OpenSearch Memory"]);
  });

  it("does not name a model the Emulator lacks for one or two letters", async () => {
    expect((await find(index, "a")).notOffered).toEqual([]);
    expect((await find(index, "op")).notOffered).toEqual([]);
    expect((await find(index, "open")).notOffered).toEqual(["Amazon OpenSearch Memory"]);
  });

  it("puts a Curated Service's operation above another service's of the same name", async () => {
    const r = await find(index, "SendMessage");
    const sqs = r.operations.findIndex((o) => o.service.sdkId === "SQS");
    const other = r.operations.findIndex((o) => o.service.sdkId !== "SQS");
    expect(sqs).toBeGreaterThanOrEqual(0);
    expect(other === -1 || sqs < other).toBe(true);
  });

  it("returns nothing for text that matches nothing", async () => {
    const r = await find(index, "zzzzqqqq");
    expect(r).toMatchObject({ services: [], operations: [], moreServices: 0, moreOperations: 0, notOffered: [] });
  });
});
