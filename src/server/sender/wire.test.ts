import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendOutcome, SendResponse } from "../../shared/send.js";
import { ModelIndex } from "../model-index/index.js";
import { startFakeEmulator } from "./fake-emulator.testkit.js";
import type { FakeEmulator, Seen } from "./fake-emulator.testkit.js";
import { sendOperation } from "./send.js";

// What each protocol puts on the wire for the shapes the Console has to get right, checked against a fake Emulator
// that also verifies every request's SigV4 signature the way a server does.

let emu: FakeEmulator;
let index: ModelIndex;
beforeAll(async () => {
  emu = await startFakeEmulator();
  index = await ModelIndex.load(emu.config.modelIndexDir);
  emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "{}" }));
});
afterAll(() => emu.close());

async function wire(sdkId: string, operation: string, input: unknown, extra: Record<string, unknown> = {}): Promise<{ outcome: SendOutcome; seen: Seen }> {
  const before = emu.seen.length;
  const outcome = await sendOperation(emu.config, index, { sdkId, operation, region: "us-east-1", input, ...extra });
  const seen = emu.seen[before];
  if (!seen) throw new Error(`nothing was sent: ${JSON.stringify(outcome).slice(0, 300)}`);
  return { outcome, seen };
}
const text = (s: Seen) => s.body.toString("utf8");

describe("signatures", () => {
  it("verify on the server side for every protocol", async () => {
    const cases: Array<[string, string, unknown]> = [
      ["DynamoDB", "ListTables", {}],
      ["Secrets Manager", "ListSecrets", {}],
      ["SNS", "ListTopics", {}],
      ["EC2", "DescribeVpcs", {}],
      ["S3", "ListBuckets", {}],
      ["API Gateway", "GetRestApis", { limit: 5 }],
      ["EventBridgeV2", "ListEventBuses", {}],
    ];
    for (const [sdkId, op, input] of cases) {
      const { seen } = await wire(sdkId, op, input);
      expect(seen.signatureValid, `${sdkId}.${op}`).toBe(true);
    }
    expect((await wire("S3", "PutObject", { Bucket: "my-bucket", Key: "a b/é.txt", Body: { text: "hi" } }, { s3Addressing: "virtual-host" })).seen.signatureValid).toBe(true);
  });
});

describe("restJson1", () => {
  it("puts labels in the path, query members in the query string, headers in headers and the payload in the body", async () => {
    const { seen } = await wire("Lambda", "Invoke", { FunctionName: "my-fn", Qualifier: "$LATEST", InvocationType: "Event", Payload: { text: '{"a":1}' } });
    expect(seen.url).toBe("/2015-03-31/functions/my-fn/invocations?Qualifier=%24LATEST");
    expect(seen.headers["x-amz-invocation-type"]).toBe("Event");
    expect(text(seen)).toBe('{"a":1}');
    expect(seen.signatureValid).toBe(true);
  });
  it("sends a long beyond 2^53 exactly", async () => {
    const { seen } = await wire("Backup", "PutBackupVaultLockConfiguration", { BackupVaultName: "vault-1", MinRetentionDays: "9007199254740993" });
    expect(text(seen)).toContain("9007199254740993");
  });
  it("writes a timestamp query member as the model's format says", async () => {
    const { seen } = await wire("Backup", "ListBackupJobs", { ByCreatedBefore: "2026-01-02T03:04:05Z" });
    expect(seen.url).toMatch(/createdBefore=2026-01-02T03%3A04%3A05Z/);
  });
});

describe("awsJson", () => {
  it("sends a long beyond 2^53 exactly (awsJson1_1) and a timestamp as epoch seconds (awsJson1_0)", async () => {
    const logs = await wire("CloudWatch Logs", "FilterLogEvents", { logGroupName: "g", startTime: "9007199254740993" });
    expect(text(logs.seen)).toContain('"startTime":9007199254740993');
    const sfn = await wire("SFN", "UpdateMapRun", { mapRunArn: "arn:aws:states:us-east-1:0:mapRun:a/b:c", toleratedFailureCount: "9007199254740993" });
    expect(text(sfn.seen)).toContain('"toleratedFailureCount":9007199254740993');
    const billing = await wire("Billing", "ListBusinessSupportSubscriptionHistory", { startDate: "2026-01-02T03:04:05Z" });
    expect(JSON.parse(text(billing.seen))).toMatchObject({ startDate: 1767323045 });
  });
});

describe("awsQuery and ec2Query", () => {
  it("awsQuery sends long and timestamp members as form fields", async () => {
    const rds = await wire("RDS", "DescribeDBLogFiles", { DBInstanceIdentifier: "db", FileSize: "9007199254740993", FileLastWritten: 5 });
    const form = new URLSearchParams(text(rds.seen));
    expect(form.get("Action")).toBe("DescribeDBLogFiles");
    expect(form.get("FileSize")).toBe("9007199254740993");
    const scaling = await wire("Auto Scaling", "DescribeScheduledActions", { StartTime: "2026-01-02T03:04:05Z" });
    expect(new URLSearchParams(text(scaling.seen)).get("StartTime")).toBe("2026-01-02T03:04:05Z");
  });
  it("ec2Query sends a long exactly, nested tags as numbered fields and a timestamp as ISO 8601", async () => {
    const asn = await wire("EC2", "CreateRouteServer", { AmazonSideAsn: "9007199254740993" });
    expect(new URLSearchParams(text(asn.seen)).get("AmazonSideAsn")).toBe("9007199254740993");
    const vpc = await wire("EC2", "CreateVpc", { CidrBlock: "10.0.0.0/16", TagSpecifications: [{ ResourceType: "vpc", Tags: [{ Key: "k", Value: "v w" }] }] });
    const form = new URLSearchParams(text(vpc.seen));
    expect(form.get("Action")).toBe("CreateVpc");
    expect(form.get("TagSpecification.1.ResourceType")).toBe("vpc");
    expect(form.get("TagSpecification.1.Tag.1.Key")).toBe("k");
    const when = await wire("EC2", "DescribeCapacityBlockOfferings", { StartDateRange: "2026-01-02T03:04:05Z", CapacityDurationHours: 24 });
    expect(new URLSearchParams(text(when.seen)).get("StartDateRange")).toBe("2026-01-02T03:04:05Z");
  });
});

describe("restXml", () => {
  it("sends bodies as XML with the service's namespace, a long in a body member, and prefix headers for metadata", async () => {
    const tagging = await wire("S3", "PutBucketTagging", { Bucket: "b", Tagging: { TagSet: [{ Key: "x", Value: "x = y <&>" }] } });
    expect(text(tagging.seen)).toContain("<Tagging");
    expect(text(tagging.seen)).toContain("<Value>x = y &lt;&amp;&gt;</Value>");
    const put = await wire("S3", "PutObject", { Bucket: "b", Key: "k", Body: { text: "hi" }, Metadata: { own: "me" }, IfNoneMatch: "*" });
    expect(put.seen.headers["x-amz-meta-own"]).toBe("me");
    const zone = await wire("Route 53", "UpdateHealthCheck", { HealthCheckId: "abc", HealthCheckVersion: "9007199254740993" });
    expect(text(zone.seen)).toContain("<HealthCheckVersion>9007199254740993</HealthCheckVersion>");
  });
  it("writes a timestamp header as an HTTP date", async () => {
    const { seen } = await wire("S3", "GetObject", { Bucket: "b", Key: "k", IfModifiedSince: "2026-01-02T03:04:05Z" });
    expect(seen.headers["if-modified-since"]).toBe("Fri, 02 Jan 2026 03:04:05 GMT");
  });
  it("keys virtual-host addressing on the S3 service, not on its signing name (S3 Control signs as s3 too)", async () => {
    const { outcome, seen } = await wire("S3 Control", "ListAccessGrantsInstances", { AccountId: "123456789012" }, { s3Addressing: "virtual-host" });
    expect(seen.headers.host).not.toContain("amazonaws.com");
    expect((outcome as SendResponse).request.url).not.toContain(".s3.");
  });
  it("shows the address a Developer reaches and the bucket host for virtual-host", async () => {
    const path = await wire("S3", "GetObject", { Bucket: "my-bucket", Key: "k" });
    expect((path.outcome as SendResponse).request.url).toBe(`https://127.0.0.1:${emu.config.emulatorPort}/my-bucket/k?x-id=GetObject`);
    const virtual = await wire("S3", "GetObject", { Bucket: "my-bucket", Key: "k" }, { s3Addressing: "virtual-host" });
    expect((virtual.outcome as SendResponse).request.url).toBe(`https://my-bucket.s3.us-east-1.amazonaws.com:${emu.config.emulatorPort}/k?x-id=GetObject`);
  });
});

describe("rpcv2Cbor", () => {
  it("sends CBOR with a tagged timestamp", async () => {
    const { seen } = await wire("PartnerCentral Revenue Measurement", "ListMarketplaceRevenueShares", { Catalog: "AWS", CreatedAfter: "2026-01-02T03:04:05Z" });
    expect(seen.headers["smithy-protocol"]).toBe("rpc-v2-cbor");
    expect(seen.body.includes(0xc1)).toBe(true); // tag 1: epoch-based date/time
    expect(seen.signatureValid).toBe(true);
  });
});

describe("input conversion", () => {
  it("sends one member of a union", async () => {
    const { seen } = await wire("DynamoDB", "PutItem", { TableName: "t", Item: { a: { M: { b: { L: [{ S: "x" }, { N: "1" }, { NULL: true }] } } } } });
    expect(JSON.parse(text(seen)).Item.a.M.b.L).toEqual([{ S: "x" }, { N: "1" }, { NULL: true }]);
  });
  it("sends a timestamp that does not parse as written when asked to send invalid input, and never reads blank text as epoch 0", async () => {
    const bad = await wire("Billing", "ListBusinessSupportSubscriptionHistory", { startDate: "not a date" }, { sendInvalid: true });
    expect(JSON.parse(text(bad.seen)).startDate).toBe("not a date");
    const blank = await wire("Billing", "ListBusinessSupportSubscriptionHistory", { startDate: " " }, { sendInvalid: true });
    expect(JSON.parse(text(blank.seen)).startDate).toBe(" ");
  });
});

describe("refusals before sending", () => {
  it("refuses a header value with a line break, in the problems, without sending", async () => {
    const before = emu.seen.length;
    const o = await sendOperation(emu.config, index, { sdkId: "S3", operation: "PutObject", region: "us-east-1", input: { Bucket: "b", Key: "k", Body: { text: "x" }, Metadata: { a: "x\r\nX-Evil: 1" } }, sendInvalid: true });
    expect(o).toMatchObject({ kind: "invalid", problems: [{ path: "x-amz-meta-a", rule: "header" }] });
    expect(emu.seen.length).toBe(before);
  });
  it("names the header when S3 metadata is not ASCII (it would sign differently from what is sent)", async () => {
    const o = await sendOperation(emu.config, index, { sdkId: "S3", operation: "PutObject", region: "us-east-1", input: { Bucket: "b", Key: "k", Body: { text: "x" }, Metadata: { own: "é" } } });
    expect(o).toMatchObject({ kind: "invalid", problems: [{ path: "x-amz-meta-own", rule: "header" }] });
  });
  it("does not hang on a declared ContentLength with no Body", async () => {
    const started = Date.now();
    const { seen } = await wire("S3", "PutObject", { Bucket: "b", Key: "k", ContentLength: 5 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(seen.headers["content-length"]).not.toBe("5");
  });
});

describe("answers", () => {
  it("does not read an oversized answer to its end: it is reported too large, not unreadable", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, "a");
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: big }));
    const { outcome } = await wire("SQS", "ListQueues", {});
    const r = outcome as SendResponse;
    expect(r).toMatchObject({ tooLarge: true, unreadable: false });
    expect(r.raw).toMatchObject({ truncated: true, sizeIsMinimum: true });
    expect(r.raw.size).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "{}" }));
  });
  it("cuts a large blob member of the output at 256 KB and lists it", async () => {
    const blob = Buffer.alloc(300 * 1024, 7);
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ CiphertextBlob: blob.toString("base64"), KeyId: "k" }) }));
    const { outcome } = await wire("KMS", "Encrypt", { KeyId: "k", Plaintext: { text: "p" } });
    const r = outcome as SendResponse;
    expect(Buffer.from((r.output as { CiphertextBlob: string }).CiphertextBlob, "base64")).toHaveLength(256 * 1024);
    expect(r.truncatedMembers).toEqual([{ path: "CiphertextBlob", size: 300 * 1024 }]);
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "{}" }));
  });
  it("reads UnknownService from the wire code when the SDK cannot name the error", async () => {
    emu.answer(() => ({ status: 404, headers: { "x-amzn-errortype": "UnknownService" }, body: "plain text" }));
    const { outcome } = await wire("SQS", "ListQueues", {});
    expect(outcome).toMatchObject({ emulatorGap: true });
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "{}" }));
  });
  it("uses the real timeout in its message", async () => {
    emu.answer(() => ({ hang: true }));
    const o = await sendOperation(emu.config, index, { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" }, { timeoutMs: 2000 });
    expect(o).toMatchObject({ kind: "no-response", reason: "timeout", message: expect.stringContaining("after 2 s") });
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "{}" }));
  });
});
