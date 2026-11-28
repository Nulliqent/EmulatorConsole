import http from "node:http";
import { describe, expect, it } from "vitest";
import type { ServicesResponse } from "../src/shared/models.js";
import type { SendOutcome, SendResponse } from "../src/shared/send.js";

// Against the shared e2e stack (scripts/e2e.sh up): the Console's POST /api/send, the Emulator behind it.
const CONSOLE_PORT = Number(process.env.E2E_CONSOLE_PORT ?? 19298);

function call(method: string, urlPath: string, body?: unknown) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: CONSOLE_PORT,
        path: urlPath,
        method,
        agent: false,
        headers: {
          host: `127.0.0.1:${CONSOLE_PORT}`,
          ...(payload === undefined ? {} : { origin: `http://127.0.0.1:${CONSOLE_PORT}`, "content-type": "application/json" }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function send(sdkId: string, operation: string, input: unknown = {}, extra: Record<string, unknown> = {}): Promise<SendOutcome> {
  const res = await call("POST", "/api/send", { sdkId, operation, region: "us-east-1", input, ...extra });
  if (res.status !== 200) throw new Error(`POST /api/send ${sdkId}.${operation}: HTTP ${res.status} ${res.body.slice(0, 200)}`);
  return JSON.parse(res.body) as SendOutcome;
}

/** A call that must come back 2xx and parsed. */
async function ok(sdkId: string, operation: string, input: unknown = {}, extra: Record<string, unknown> = {}): Promise<SendResponse> {
  const o = await send(sdkId, operation, input, extra);
  if (o.kind !== "response") throw new Error(`${sdkId}.${operation}: ${JSON.stringify(o).slice(0, 300)}`);
  if (o.status < 200 || o.status >= 300 || o.unreadable) {
    throw new Error(`${sdkId}.${operation}: ${o.status} unreadable=${o.unreadable} ${JSON.stringify(o.error)} ${o.raw.body.slice(0, 300)}`);
  }
  return o;
}

const unique = () => `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("round trips in all seven protocols", () => {
  it("awsJson1_0: DynamoDB creates a table, puts and gets an item, deletes the table", async () => {
    const t = unique();
    await ok("DynamoDB", "CreateTable", {
      TableName: t, BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }], KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    });
    try {
      for (let i = 0; i < 40; i++) {
        const status = ((await ok("DynamoDB", "DescribeTable", { TableName: t })).output as { Table: { TableStatus: string } }).Table.TableStatus;
        if (status === "ACTIVE") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await ok("DynamoDB", "PutItem", { TableName: t, Item: { id: { S: "a" }, m: { M: { l: { L: [{ N: "1.5" }, { BOOL: true }, { NULL: true }] } } }, b: { B: "AP8H" } } });
      const got = await ok("DynamoDB", "GetItem", { TableName: t, Key: { id: { S: "a" } } });
      expect(got.output).toMatchObject({ Item: { id: { S: "a" }, m: { M: { l: { L: [{ N: "1.5" }, { BOOL: true }, { NULL: true }] } } }, b: { B: "AP8H" } } });
    } finally {
      await ok("DynamoDB", "DeleteTable", { TableName: t });
    }
  });

  it("awsJson1_0 with awsQueryCompatible: SQS round-trips a message and reports a declared error", async () => {
    const q = unique();
    const created = await ok("SQS", "CreateQueue", { QueueName: q, tags: { k: "v&=é" } });
    const url = (created.output as { QueueUrl: string }).QueueUrl;
    try {
      await ok("SQS", "SendMessage", { QueueUrl: url, MessageBody: "hé <&>", MessageAttributes: { a: { DataType: "String", StringValue: "z" } } });
      const got = await ok("SQS", "ReceiveMessage", { QueueUrl: url, MessageAttributeNames: ["All"] });
      expect(got.output).toMatchObject({ Messages: [{ Body: "hé <&>", MessageAttributes: { a: { StringValue: "z" } } }] });
    } finally {
      await ok("SQS", "DeleteQueue", { QueueUrl: url });
    }
    const missing = await send("SQS", "GetQueueUrl", { QueueName: `${q}-nope` });
    expect(missing).toMatchObject({ kind: "response", error: { declared: true }, emulatorGap: false });
  });

  it("awsJson1_1: Secrets Manager creates, reads and deletes a secret", async () => {
    const n = unique();
    await ok("Secrets Manager", "CreateSecret", { Name: n, SecretString: "s3cret" });
    try {
      expect((await ok("Secrets Manager", "GetSecretValue", { SecretId: n })).output).toMatchObject({ Name: n, SecretString: "s3cret" });
    } finally {
      await ok("Secrets Manager", "DeleteSecret", { SecretId: n, ForceDeleteWithoutRecovery: true });
    }
  });

  it("awsQuery: SNS creates a topic with an attribute, reads it back, deletes it", async () => {
    const n = unique();
    const arn = ((await ok("SNS", "CreateTopic", { Name: n, Attributes: { DisplayName: "hi there" } })).output as { TopicArn: string }).TopicArn;
    try {
      expect((await ok("SNS", "GetTopicAttributes", { TopicArn: arn })).output).toMatchObject({ Attributes: { DisplayName: "hi there" } });
    } finally {
      await ok("SNS", "DeleteTopic", { TopicArn: arn });
    }
  });

  it("ec2Query: EC2 creates a VPC with a tag, finds it by filter, deletes it", async () => {
    const n = unique();
    const vpc = ((await ok("EC2", "CreateVpc", { CidrBlock: "10.9.0.0/16", TagSpecifications: [{ ResourceType: "vpc", Tags: [{ Key: "n", Value: n }] }] })).output as { Vpc: { VpcId: string } }).Vpc.VpcId;
    try {
      const found = await ok("EC2", "DescribeVpcs", { Filters: [{ Name: "tag:n", Values: [n] }] });
      expect((found.output as { Vpcs: { VpcId: string }[] }).Vpcs.map((v) => v.VpcId)).toEqual([vpc]);
    } finally {
      await ok("EC2", "DeleteVpc", { VpcId: vpc });
    }
  });

  it("restXml: S3 round-trips an object path-style and virtual-host style, with metadata, tags and a key with spaces", async () => {
    const b = unique();
    await ok("S3", "CreateBucket", { Bucket: b });
    const key = "a b/é+c.txt";
    try {
      await ok("S3", "PutObject", { Bucket: b, Key: key, Body: { text: "hello" }, ContentType: "text/plain", Metadata: { own: "me" } });
      await ok("S3", "PutBucketTagging", { Bucket: b, Tagging: { TagSet: [{ Key: "x", Value: "x = y/é" }] } });
      const got = await ok("S3", "GetObject", { Bucket: b, Key: key });
      expect(got.output).toMatchObject({ Body: Buffer.from("hello").toString("base64"), Metadata: { own: "me" }, ContentType: "text/plain" });
      expect((await ok("S3", "GetBucketTagging", { Bucket: b })).output).toMatchObject({ TagSet: [{ Key: "x", Value: "x = y/é" }] });
      // The same object by a virtual-host address.
      const virtual = await ok("S3", "GetObject", { Bucket: b, Key: key }, { s3Addressing: "virtual-host" });
      expect(virtual.request.url).toContain(`${b}.s3.us-east-1.amazonaws.com`);
      expect(virtual.output).toMatchObject({ Body: Buffer.from("hello").toString("base64") });
      await ok("S3", "PutObject", { Bucket: b, Key: "v.txt", Body: { text: "virtual" } }, { s3Addressing: "virtual-host" });
      expect((await ok("S3", "ListObjectsV2", { Bucket: b })).output).toMatchObject({ KeyCount: 2 });
      await ok("S3", "DeleteObject", { Bucket: b, Key: "v.txt" });
    } finally {
      await ok("S3", "DeleteObject", { Bucket: b, Key: key });
      await ok("S3", "DeleteBucket", { Bucket: b });
    }
  });

  it("restJson1: API Gateway creates, reads and deletes a REST API (names mapped through jsonName, paths and tags)", async () => {
    const n = unique();
    const api = (await ok("API Gateway", "CreateRestApi", { name: n, description: "d", tags: { a: "b" }, endpointConfiguration: { types: ["REGIONAL"] } })).output as { id: string };
    try {
      expect((await ok("API Gateway", "GetRestApi", { restApiId: api.id })).output).toMatchObject({ id: api.id, name: n, tags: { a: "b" } });
    } finally {
      await ok("API Gateway", "DeleteRestApi", { restApiId: api.id });
    }
  });

  it("rpcv2Cbor: EventBridgeV2 creates, describes and deletes an event bus", async () => {
    const n = unique();
    const bus = (await ok("EventBridgeV2", "CreateEventBus", { Name: n })).output as { EventBusArn: string };
    try {
      expect((await ok("EventBridgeV2", "DescribeEventBus", { EventBusArn: bus.EventBusArn })).output).toMatchObject({ EventBusArn: bus.EventBusArn });
    } finally {
      await ok("EventBridgeV2", "DeleteEventBus", { EventBusArn: bus.EventBusArn });
    }
  });
});

describe("input and answers", () => {
  it("returns the problems without sending when the input breaks the model, and sends it when asked", async () => {
    const bad = await send("DynamoDB", "CreateTable", { TableName: "" });
    expect(bad.kind).toBe("invalid");
    const sent = await send("DynamoDB", "CreateTable", { TableName: "" }, { sendInvalid: true });
    expect(sent).toMatchObject({ kind: "response" });
    expect((sent as SendResponse).problems.length).toBeGreaterThan(0);
    expect((sent as SendResponse).status).toBeGreaterThanOrEqual(400);
  });

  it("never returns the run's keys", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(import.meta.dirname, "..", ".aws", "e2e", "19297", "emulator_credentials");
    const values = [...fs.readFileSync(file, "utf8").matchAll(/=\s*(\S+)/g)].map((m) => m[1]!);
    const res = await call("POST", "/api/send", { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" });
    expect(values.length).toBeGreaterThanOrEqual(2);
    for (const v of values) expect(res.body.includes(v), "a credential value is in the response").toBe(false);
    expect(res.body.toLowerCase()).not.toContain("authorization");
  });
});

describe("every list operation that needs no input", () => {
  it(
    "sends and parses against the Emulator without a serialization failure",
    async () => {
      const services = (JSON.parse((await call("GET", "/api/services")).body) as ServicesResponse).services;
      const jobs = services.flatMap((s) => s.listOperations.map((operation) => ({ sdkId: s.sdkId, operation })));
      const tally = { total: jobs.length, services: new Set(jobs.map((j) => j.sdkId)).size, success: 0, emulatorGap: 0, declaredError: 0, otherError: 0 };
      const failures: string[] = [];
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const { sdkId, operation } = jobs[next++]!;
          try {
            const o = await send(sdkId, operation, {});
            if (o.kind !== "response") failures.push(`${sdkId}.${operation}: ${o.kind} ${JSON.stringify(o).slice(0, 200)}`);
            else if (o.unreadable) failures.push(`${sdkId}.${operation}: unreadable ${o.status} ${o.raw.body.slice(0, 160)}`);
            else if (o.emulatorGap) tally.emulatorGap++;
            else if (o.error?.declared) tally.declaredError++;
            else if (o.error) tally.otherError++;
            else tally.success++;
          } catch (e) {
            failures.push(`${sdkId}.${operation}: ${(e as Error).message.slice(0, 200)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));
      console.log("list-operation sweep", JSON.stringify({ ...tally, failures: failures.length }));
      if (failures.length) console.log(failures.join("\n"));
      expect(tally.total).toBeGreaterThan(1000);
      expect(failures).toEqual([]);
    },
    20 * 60 * 1000,
  );
});
