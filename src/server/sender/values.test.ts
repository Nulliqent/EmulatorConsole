import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ModelIndex } from "../model-index/index.js";
import type { ServiceModelFile } from "../model-index/index.js";
import { compileService } from "./schema.js";
import { toJson, toSdkInput, validateInput } from "./values.js";

let index: ModelIndex;
const detail = (key: string) => index.detail(key) as Promise<ServiceModelFile>;
beforeAll(async () => {
  index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
});

describe("validateInput", () => {
  it("reports required, length, range, pattern, enum, type and unknown members, with paths", async () => {
    const d = await detail("DynamoDB");
    const problems = validateInput(d.shapes, "com.amazonaws.dynamodb#CreateTableInput", {
      TableName: "",
      BillingMode: "FREE",
      ProvisionedThroughput: { ReadCapacityUnits: 0 },
      AttributeDefinitions: "nope",
      Bogus: 1,
    });
    const by = (rule: string) => problems.filter((p) => p.rule === rule).map((p) => p.path);
    expect(by("length")).toContain("TableName");
    expect(by("enum")).toContain("BillingMode");
    expect(by("range")).toContain("ProvisionedThroughput.ReadCapacityUnits");
    expect(by("required")).toContain("ProvisionedThroughput.WriteCapacityUnits");
    expect(by("type")).toContain("AttributeDefinitions");
    expect(by("unknown-member")).toContain("Bogus");
  });

  it("checks patterns", async () => {
    const d = await detail("SQS");
    const op = d.operations.find((o) => o.name === "CreateQueue")!;
    expect(validateInput(d.shapes, op.input, { QueueName: "ok-name" })).toEqual([]);
  });

  it("accepts a valid input, and an omitted one when nothing is required", async () => {
    const d = await detail("DynamoDB");
    expect(validateInput(d.shapes, "com.amazonaws.dynamodb#ListTablesInput", {})).toEqual([]);
    expect(validateInput(d.shapes, "com.amazonaws.dynamodb#ListTablesInput", undefined)).toEqual([]);
    expect(validateInput(d.shapes, "com.amazonaws.dynamodb#ListTablesInput", { Limit: 10, ExclusiveStartTableName: "abc" })).toEqual([]);
    expect(validateInput(d.shapes, undefined, { anything: 1 })).toEqual([]);
  });

  it("accepts blobs as base64 or text, timestamps as ISO or epoch seconds", async () => {
    const d = await detail("KMS");
    expect(validateInput(d.shapes, "com.amazonaws.kms#EncryptRequest", { KeyId: "k", Plaintext: "AQID" })).toEqual([]);
    expect(validateInput(d.shapes, "com.amazonaws.kms#EncryptRequest", { KeyId: "k", Plaintext: { text: "hi" } })).toEqual([]);
    expect(validateInput(d.shapes, "com.amazonaws.kms#EncryptRequest", { KeyId: "k", Plaintext: 5 }).map((p) => p.rule)).toEqual(["type"]);
  });

  it("stays bounded on recursive shapes", async () => {
    const d = await detail("DynamoDB");
    let item: Record<string, unknown> = { S: "x" };
    for (let i = 0; i < 200; i++) item = { M: { k: item } };
    expect(() => validateInput(d.shapes, "com.amazonaws.dynamodb#PutItemInput", { TableName: "t", Item: { a: item } })).not.toThrow();
  });
});

describe("toSdkInput and toJson", () => {
  it("converts blobs, timestamps and big numbers for the serializers", async () => {
    const d = await detail("KMS");
    const converted = toSdkInput(d.shapes, "com.amazonaws.kms#EncryptRequest", { KeyId: "k", Plaintext: "AQID" }) as { Plaintext: Uint8Array };
    expect([...converted.Plaintext]).toEqual([1, 2, 3]);
    const text = toSdkInput(d.shapes, "com.amazonaws.kms#EncryptRequest", { KeyId: "k", Plaintext: { text: "hi" } }) as { Plaintext: Uint8Array };
    expect(Buffer.from(text.Plaintext).toString()).toBe("hi");
  });

  it("drops members the model lacks, and survives __proto__ as a map key", async () => {
    const d = await detail("SQS");
    const out = toSdkInput(d.shapes, "com.amazonaws.sqs#CreateQueueRequest", JSON.parse('{"QueueName":"q","Bogus":1,"tags":{"__proto__":"x"}}')) as Record<string, unknown>;
    expect(out).not.toHaveProperty("Bogus");
    expect(Object.keys(out.tags as object)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(out.tags)).toBe(null);
  });

  it("turns parsed output into JSON", async () => {
    const json = await toJson({
      $metadata: { httpStatusCode: 200 },
      When: new Date("2026-01-02T03:04:05Z"),
      Data: new Uint8Array([1, 2, 3]),
      Big: 10n,
      Huge: 9007199254740993n,
      Nested: [{ a: undefined, b: null }],
      Stream: { transformToByteArray: async () => new Uint8Array([104, 105]) },
    });
    expect(json).toEqual({ When: "2026-01-02T03:04:05.000Z", Data: "AQID", Big: 10, Huge: "9007199254740993", Nested: [{ b: null }], Stream: "aGk=" });
  });
});

describe("schema conversion", () => {
  it("compiles every service in the index without error and gives each operation a schema", async () => {
    let operations = 0;
    for (const summary of index.services()) {
      const d = (await index.detail(summary.sdkId))!;
      const compiled = compileService(d, summary);
      for (const op of d.operations) {
        expect(compiled.operation(op.name), `${summary.sdkId}.${op.name}`).toBeDefined();
        operations++;
      }
      expect(compiled.createProtocol()).toBeDefined();
      // Every aggregate shape builds: no member refers to a shape the model lacks (a union member of `smithy.api#Unit` once did).
      for (const [id, shape] of Object.entries(d.shapes)) {
        if (["structure", "union", "list", "set", "map"].includes(shape.type)) expect(() => compiled.shape(id), `${summary.sdkId} ${id}`).not.toThrow();
      }
    }
    expect(operations).toBeGreaterThan(10000);
  }, 120_000);

  it("reads the signing name and service name from the model", async () => {
    const sqs = compileService(await detail("SQS"), index.service("SQS")!);
    expect(sqs).toMatchObject({ signingName: "sqs", serviceName: "AmazonSQS", protocol: "awsJson1_0" });
    const s3 = compileService(await detail("S3"), index.service("S3")!);
    expect(s3).toMatchObject({ signingName: "s3", protocol: "restXml" });
  });
});

describe("synthetic shapes", () => {
  const shapes = {
    "t#In": { type: "structure", members: { L: { target: "t#Sparse" }, M: { target: "t#SparseMap" }, N: { target: "t#Dense" }, Big: { target: "smithy.api#Long" }, P: { target: "t#P" } } },
    "t#Sparse": { type: "list", traits: { "smithy.api#sparse": {} }, member: { target: "smithy.api#String" } },
    "t#SparseMap": { type: "map", traits: { "smithy.api#sparse": {} }, key: { target: "smithy.api#String" }, value: { target: "smithy.api#String" } },
    "t#Dense": { type: "list", member: { target: "smithy.api#String" } },
    // Valid only without the `u` flag: `\-` is an identity escape.
    "t#P": { type: "string", traits: { "smithy.api#pattern": "^[a-z\\-]+$" } },
  } as never;

  it("allows nulls in sparse lists and maps only", () => {
    expect(validateInput(shapes, "t#In", { L: ["a", null], M: { k: null } })).toEqual([]);
    expect(validateInput(shapes, "t#In", { N: ["a", null] }).map((p) => p.path)).toEqual(["N[1]"]);
    expect(toSdkInput(shapes, "t#In", { L: ["a", null], M: { k: null } })).toEqual({ L: ["a", null], M: { k: null } });
  });
  it("checks long exactly, as 64-bit integers", () => {
    expect(validateInput(shapes, "t#In", { Big: "9223372036854775807" })).toEqual([]);
    expect(validateInput(shapes, "t#In", { Big: "-9223372036854775808" })).toEqual([]);
    expect(validateInput(shapes, "t#In", { Big: "9223372036854775808" }).map((p) => p.rule)).toEqual(["range"]);
    expect(validateInput(shapes, "t#In", { Big: 1e30 }).map((p) => p.rule)).toEqual(["range"]);
  });
  it("turns unsafe integer text into a bigint, and leaves safe ones numbers", () => {
    expect(toSdkInput(shapes, "t#In", { Big: "9007199254740993" })).toEqual({ Big: 9007199254740993n });
    expect(toSdkInput(shapes, "t#In", { Big: "12" })).toEqual({ Big: 12 });
  });
  it("retries a pattern without the u flag, and caches it", () => {
    expect(validateInput(shapes, "t#In", { P: "ab-c" })).toEqual([]);
    expect(validateInput(shapes, "t#In", { P: "AB" }).map((p) => p.rule)).toEqual(["pattern"]);
  });
});
