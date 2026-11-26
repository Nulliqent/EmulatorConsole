import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { ModelIndex, sensitivePaths } from "./index.js";

// Checks the committed artifact in data/model-index. The numbers come from ADR 0005 and the spike notes; where one
// did not reproduce, the number asserted here is the one the build derives, and the comment says so.

let index: ModelIndex;

beforeAll(async () => {
  index = await ModelIndex.load(loadConfig({}).modelIndexDir);
});

describe("the committed Service Model index", () => {
  it("is found at the default location", () => {
    expect(loadConfig({}).modelIndexDir).toBe(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
  });

  it("holds the 436 services the Emulator offers, of 439 models", () => {
    expect(index.services()).toHaveLength(436);
    expect(index.meta.counts.services).toBe(436);
    expect(index.meta.models).toMatchObject({ total: 439, offered: 436 });
    expect(index.meta.models.notOffered.map((m) => m.sdkId)).toEqual(["ConnectScheduling", "OpenSearchMemory", "SageMaker Inference Router Runtime"]);
    expect(new Set(index.services().map((s) => s.sdkId)).size).toBe(436);
    expect(index.service("DynamoDB")?.title).toBe("Amazon DynamoDB");
    expect(index.service("ConnectScheduling")).toBeUndefined();
  });

  it("classifies lists: 357 through List or Describe, 8 only through Get or Search, 71 neither", () => {
    expect(index.meta.counts.listClass).toEqual({ list: 357, "get-or-search": 8, none: 71 });
    const counted = { list: 0, "get-or-search": 0, none: 0 };
    for (const s of index.services()) {
      counted[s.listClass]++;
      // Only operations the Emulator implements are offered, so a service can be classified list with none to offer.
      if (s.listClass !== "list") expect(s.listOperations).toEqual([]);
    }
    expect(counted).toEqual({ list: 357, "get-or-search": 8, none: 71 });
    expect(index.service("DynamoDB")?.listOperations).toContain("ListTables");
  });

  it("records the protocols, including the awsQueryCompatible variant and the three CBOR-only services", () => {
    expect(index.meta.counts.protocols).toEqual({
      restJson1: 260, awsJson1_0: 51, awsJson1_1: 102, awsQuery: 15, ec2Query: 1, restXml: 4, rpcv2Cbor: 3,
    });
    expect(index.meta.counts.awsQueryCompatible).toBe(2);
    expect(index.services().filter((s) => s.awsQueryCompatible).every((s) => s.protocol === "awsJson1_0")).toBe(true);
    expect(index.services().filter((s) => s.protocol === "rpcv2Cbor").map((s) => s.sdkId).sort()).toEqual(
      ["CloudWatchOmni", "EventBridgeV2", "PartnerCentral Revenue Measurement"].sort(),
    );
    expect(index.service("EC2")?.protocol).toBe("ec2Query");
    expect(index.service("S3")?.protocol).toBe("restXml");
  });

  it("names the Emulator version its labels describe", () => {
    expect(index.meta.emulator.version).toBe("1.0.509");
    expect(index.meta.emulator.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("counts stubs in the Emulator's 19,405 operation files", () => {
    const c = index.meta.counts;
    expect(c.emulatorOperationFiles).toBe(19405);
    // ADR 0005 and the spike notes say 7,291. Counting the machine-readable marker the Emulator documents
    // (a line starting "//! SCAFFOLDED, NOT IMPLEMENTED:") gives 7,192; a loose text search gives 7,296.
    expect(c.scaffoldedStubFiles).toBe(7192);
    expect(c.unwiredOperations).toBe(44);
  });

  it("labels every operation, and the labels add up", () => {
    const c = index.meta.counts;
    expect(c.implemented + c.notImplemented + c.notInEmulator).toBe(c.operations);
    for (const s of index.services()) expect(s.implemented + s.notImplemented + s.notInEmulator).toBe(s.operationCount);
    // The Service Models and the Emulator's own differ in 62 services, 388 operations (ADR 0005).
    const differing = index.services().filter((s) => s.notInEmulator > 0 || s.emulatorOnly > 0);
    expect(differing).toHaveLength(62);
    expect(c.notInEmulator + c.emulatorOnly).toBe(388);
  });

  it("gives each operation its implementation label", async () => {
    expect((await index.operation("DynamoDB", "PutItem"))?.implementation).toBe("implemented");
    expect((await index.operation("DynamoDB", "CreateGlobalTable"))?.implementation).toBe("implemented");
    expect((await index.operation("AccessAnalyzer", "ApplyArchiveRule"))?.implementation).toBe("not-implemented");
  });

  it("marks sensitive members for masking", async () => {
    const create = (await index.operation("Secrets Manager", "CreateSecret"))!;
    expect(create.sensitive.input).toContain("SecretString");
    expect(create.sensitive.input).toContain("SecretBinary");
    const get = (await index.operation("Secrets Manager", "GetSecretValue"))!;
    expect(get.sensitive.output).toContain("SecretString");
    expect(get.sensitive.input).toEqual([]);
    expect(index.services().reduce((n, s) => n + s.sensitiveOperations, 0)).toBeGreaterThan(1000);
  });

  it("keeps each operation's shapes and declared errors", async () => {
    const detail = (await index.detail("DynamoDB"))!;
    const put = detail.operations.find((o) => o.name === "PutItem")!;
    expect(put.input).toBe("com.amazonaws.dynamodb#PutItemInput");
    expect(put.errors).toContain("com.amazonaws.dynamodb#ConditionalCheckFailedException");
    const input = detail.shapes[put.input!];
    expect(input.type).toBe("structure");
    expect(input.members?.TableName.traits?.["smithy.api#required"]).toBeDefined();
    expect(detail.shapes["com.amazonaws.dynamodb#ConditionalCheckFailedException"].traits?.["smithy.api#error"]).toBe("client");
    expect(await index.detail("Nope")).toBeUndefined();
  });

  it("looks services up by SDK ID or slug, and shapes by own property only", async () => {
    expect(index.service("secrets-manager")).toBe(index.service("Secrets Manager"));
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(index.service(key)).toBeUndefined();
      expect(await index.shape("DynamoDB", key)).toBeUndefined();
    }
    expect(await index.shape("dynamodb", "com.amazonaws.dynamodb#PutItemInput")).toBeDefined();
    expect(await index.operationShapes("DynamoDB", "Nope")).toBeUndefined();
    const reach = (await index.operationShapes("DynamoDB", "PutItem"))!;
    expect(Object.keys(reach)).toContain("com.amazonaws.dynamodb#AttributeValue");
    expect(Object.keys(reach).length).toBeLessThan(Object.keys((await index.detail("DynamoDB"))!.shapes).length);
  });

  it("keeps the error traits Verdict matching needs", async () => {
    const sqs = (await index.detail("SQS"))!;
    const codes = Object.values(sqs.shapes).filter((s) => s.traits?.["aws.protocols#awsQueryError"]);
    expect(codes.length).toBeGreaterThan(0);
    const s3 = (await index.detail("S3"))!;
    expect(Object.values(s3.shapes).some((s) => s.traits?.["smithy.api#httpError"] !== undefined)).toBe(true);
  });

  it("offers list operations only from the List and Describe tier, and only ones the Emulator implements", async () => {
    for (const s of index.services()) {
      const ops = new Map((await index.detail(s.sdkId))!.operations.map((o) => [o.name, o]));
      for (const n of s.listOperations) expect(ops.get(n)).toMatchObject({ list: "list", implementation: "implemented" });
      for (const n of s.getOrSearchOperations) expect(ops.get(n)).toMatchObject({ list: "get-or-search", implementation: "implemented" });
    }
  });

  it("recomputing every operation's sensitive paths with a fresh memo gives what the build stored", async () => {
    for (const s of index.services()) {
      const detail = (await index.detail(s.sdkId))!;
      for (const o of detail.operations) {
        expect({ n: `${s.sdkId}.${o.name}`, i: sensitivePaths(detail.shapes, o.input), o: sensitivePaths(detail.shapes, o.output) }).toEqual({
          n: `${s.sdkId}.${o.name}`,
          i: o.sensitive.input,
          o: o.sensitive.output,
        });
      }
    }
  }, 60_000);

  it("keeps FSx's ONTAP admin password in every output that carries it, whatever order operations are built in", async () => {
    const fsx = (await index.detail("FSx"))!;
    const hits = fsx.operations.filter((o) => o.sensitive.output.some((p) => p.endsWith("FsxAdminPassword")));
    expect(hits.length).toBeGreaterThanOrEqual(18);
    expect(hits.map((o) => o.name)).toEqual(expect.arrayContaining(["CreateVolume", "DescribeVolumes", "CreateSnapshot"]));
  });

  it("caps the shape graphs held in memory by decompressed bytes, and evicts the least recently used", async () => {
    const small = await ModelIndex.load(loadConfig({}).modelIndexDir, { maxCacheBytes: 700_000 });
    const names = ["DynamoDB", "SQS", "SNS", "S3", "IAM", "KMS"];
    for (const n of names) await small.detail(n);
    const stats = small.cacheStats();
    expect(stats.services.length).toBeLessThan(names.length);
    expect(stats.services.at(-1)).toBe("KMS"); // the newest stays
    expect(stats.services).not.toContain("DynamoDB"); // the oldest went first
    expect(stats.bytes).toBeLessThanOrEqual(700_000);
    const again = await small.detail("DynamoDB"); // reads the file again
    expect(again?.sdkId).toBe("DynamoDB");
    expect(small.cacheStats().services.at(-1)).toBe("DynamoDB");
  });

  it("keeps a service loaded while it stays under the cap", async () => {
    const roomy = await ModelIndex.load(loadConfig({}).modelIndexDir);
    const a = await roomy.detail("EC2");
    expect(await roomy.detail("ec2")).toBe(a);
    expect(roomy.cacheStats().services).toEqual(["EC2"]);
  });
});
