import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendResponse } from "../../shared/send.js";
import { ModelIndex } from "../model-index/index.js";
import { FAKE_ACCESS_KEY, FAKE_SECRET, startFakeEmulator } from "./fake-emulator.testkit.js";
import type { FakeEmulator } from "./fake-emulator.testkit.js";
import { BadSendRequest, sendOperation } from "./send.js";

let emu: FakeEmulator;
let index: ModelIndex;

beforeAll(async () => {
  emu = await startFakeEmulator();
  index = await ModelIndex.load(emu.config.modelIndexDir);
});
afterAll(() => emu.close());

const send = (sdkId: string, operation: string, input?: unknown, extra: Record<string, unknown> = {}) =>
  sendOperation(emu.config, index, { sdkId, operation, region: "us-east-1", input, ...extra });
const asResponse = (o: Awaited<ReturnType<typeof send>>) => {
  expect(o.kind).toBe("response");
  return o as SendResponse;
};

describe("serializing and signing", () => {
  it("sends awsJson1_0 with the target header, a SigV4 signature for the service and Region, and parses the answer", async () => {
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ QueueUrl: "https://localhost/000000000000/q1" }) }));
    const r = asResponse(await send("SQS", "CreateQueue", { QueueName: "q1", tags: { a: "b" } }));
    expect(r.status).toBe(200);
    expect(r.output).toEqual({ QueueUrl: "https://localhost/000000000000/q1" });
    expect(r.unreadable).toBe(false);
    const seen = emu.seen.at(-1)!;
    expect(seen.method).toBe("POST");
    expect(seen.headers["x-amz-target"]).toBe("AmazonSQS.CreateQueue");
    expect(JSON.parse(seen.body.toString())).toEqual({ QueueName: "q1", tags: { a: "b" } });
    expect(seen.headers.authorization).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${FAKE_ACCESS_KEY}/\\d{8}/us-east-1/sqs/aws4_request`));
    expect(seen.headers.host).toBe(`127.0.0.1:${emu.config.emulatorPort}`);
  });

  it("sends awsQuery as a form body", async () => {
    emu.answer(() => ({ status: 200, body: "<CreateTopicResponse><CreateTopicResult><TopicArn>arn:aws:sns:us-east-1:0:t</TopicArn></CreateTopicResult></CreateTopicResponse>" }));
    const r = asResponse(await send("SNS", "CreateTopic", { Name: "t", Attributes: { DisplayName: "x" } }));
    expect(r.output).toEqual({ TopicArn: "arn:aws:sns:us-east-1:0:t" });
    const body = new URLSearchParams(emu.seen.at(-1)!.body.toString());
    expect(body.get("Action")).toBe("CreateTopic");
    expect(body.get("Attributes.entry.1.key")).toBe("DisplayName");
  });

  it("sends rpcv2Cbor with the service and operation in the path", async () => {
    emu.answer(() => ({ status: 200, body: Buffer.from([0xa0]), headers: { "smithy-protocol": "rpc-v2-cbor", "content-type": "application/cbor" } }));
    await send("CloudWatchOmni", "ListSpaces", {});
    const seen = emu.seen.at(-1)!;
    expect(seen.headers["smithy-protocol"]).toBe("rpc-v2-cbor");
    expect(seen.url).toMatch(/^\/service\/[^/]+\/operation\/ListSpaces$/);
  });

  it("puts the S3 bucket in the Host for virtual-host addressing and keeps the certificate check on localhost", async () => {
    emu.answer(() => ({ status: 200, body: "" }));
    await send("S3", "PutObject", { Bucket: "my-bucket", Key: "a b/c.txt", Body: { text: "hi" } }, { s3Addressing: "virtual-host" });
    const virtual = emu.seen.at(-1)!;
    expect(virtual.headers.host).toBe(`my-bucket.s3.us-east-1.amazonaws.com:${emu.config.emulatorPort}`);
    expect(virtual.url).toBe("/a%20b/c.txt?x-id=PutObject");
    expect(virtual.body.toString()).toBe("hi");
    await send("S3", "PutObject", { Bucket: "my-bucket", Key: "k", Body: { text: "hi" } });
    expect(emu.seen.at(-1)!.url).toBe("/my-bucket/k?x-id=PutObject");
  });

  it("reads the keys again when the file changes", async () => {
    emu.answer(() => ({ status: 200, body: "{}" }));
    const file = path.join(emu.home, String(emu.config.emulatorPort), "emulator_credentials");
    writeFileSync(file, "[default]\naws_access_key_id = AKIANEWKEYAFTERRESTART\naws_secret_access_key = newSecretAfterRestart0123456789abcdef\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    await send("SQS", "ListQueues", {});
    expect(emu.seen.at(-1)!.headers.authorization).toContain("Credential=AKIANEWKEYAFTERRESTART/");
    writeFileSync(file, `[default]\naws_access_key_id = ${FAKE_ACCESS_KEY}\naws_secret_access_key = ${FAKE_SECRET}\n`);
    utimesSync(file, new Date(Date.now() + 9000), new Date(Date.now() + 9000));
  });
});

describe("answers", () => {
  it("flags 501 as an Emulator Gap", async () => {
    emu.answer(() => ({ status: 501, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "NotImplemented", message: "not built" }) }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.emulatorGap).toBe(true);
    expect(r.error?.name).toBe("NotImplemented");
    expect(r.unreadable).toBe(false);
  });

  it("flags UnknownService (404) and InvalidAction as Emulator Gaps, but not a modelled error", async () => {
    emu.answer(() => ({ status: 404, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "UnknownService", message: "x" }) }));
    expect(asResponse(await send("SQS", "ListQueues", {})).emulatorGap).toBe(true);
    emu.answer(() => ({ status: 400, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "InvalidAction", message: "x" }) }));
    expect(asResponse(await send("SQS", "ListQueues", {})).emulatorGap).toBe(true);
    emu.answer(() => ({ status: 400, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "InvalidAddress", message: "x" }) }));
    const r = asResponse(await send("SQS", "CreateQueue", { QueueName: "q" }));
    expect(r.emulatorGap).toBe(false);
    expect(r.error).toMatchObject({ name: "InvalidAddress", declared: true });
  });

  it("matches SQS's awsQueryError wire code to the declared error", async () => {
    emu.answer(() => ({
      status: 400,
      headers: { "content-type": "application/x-amz-json-1.0", "x-amzn-query-error": "AWS.SimpleQueueService.NonExistentQueue;Sender" },
      body: JSON.stringify({ __type: "com.amazonaws.sqs#QueueDoesNotExist", message: "The specified queue does not exist." }),
    }));
    const r = asResponse(await send("SQS", "GetQueueUrl", { QueueName: "nope" }));
    expect(r.status).toBe(400);
    expect(r.error?.declared).toBe(true);
    expect(r.error?.message).toBe("The specified queue does not exist.");
  });

  it("says an undeclared error is undeclared", async () => {
    emu.answer(() => ({ status: 400, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "SomethingStrange", message: "hm" }) }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.error).toMatchObject({ name: "SomethingStrange", declared: false });
    expect(r.emulatorGap).toBe(false);
  });

  it("returns an answer the model cannot read raw and flagged (C7)", async () => {
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: "<html><body>Bad gateway</body></html>" }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.unreadable).toBe(true);
    expect(r.output).toBeUndefined();
    expect(r.raw).toEqual({ body: "<html><body>Bad gateway</body></html>", encoding: "utf8", size: 37, sizeIsMinimum: false, truncated: false });
    expect(r.status).toBe(200);
  });

  it("flags an error answer in the wrong format as unreadable too", async () => {
    emu.answer(() => ({ status: 502, body: "<html>nginx</html>" }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.unreadable).toBe(true);
    expect(r.raw.body).toBe("<html>nginx</html>");
  });

  it("cuts the raw body at 256 KB and reports the full size", async () => {
    const big = JSON.stringify({ QueueUrls: Array.from({ length: 20000 }, (_, i) => `https://localhost/000000000000/queue-number-${i}`) });
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: big }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.raw.size).toBe(Buffer.byteLength(big));
    expect(r.raw.truncated).toBe(true);
    expect(Buffer.byteLength(r.raw.body)).toBeLessThanOrEqual(256 * 1024);
    expect(r.unreadable).toBe(false);
    expect((r.output as { QueueUrls: string[] }).QueueUrls).toHaveLength(20000);
  });

  it("returns binary answers as base64", async () => {
    emu.answer(() => ({ status: 200, body: Buffer.from([0xff, 0xfe, 0x00, 0x01]) }));
    const r = asResponse(await send("SQS", "ListQueues", {}));
    expect(r.raw).toMatchObject({ encoding: "base64", body: "//4AAQ==", size: 4 });
  });
});

describe("input", () => {
  it("returns the problems and sends nothing when the input breaks the model", async () => {
    const before = emu.seen.length;
    const o = await send("DynamoDB", "CreateTable", { TableName: "", Bogus: 1 });
    expect(o.kind).toBe("invalid");
    if (o.kind === "invalid") expect(o.problems.map((p) => p.rule)).toEqual(expect.arrayContaining(["length", "unknown-member"]));
    expect(emu.seen.length).toBe(before);
  });

  it("sends invalid input when asked, and returns the problems with the answer", async () => {
    emu.answer(() => ({ status: 400, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ __type: "InvalidParameterValue", message: "bad name" }) }));
    const before = emu.seen.length;
    const r = asResponse(await send("DynamoDB", "CreateTable", { TableName: "", Bogus: 1 }, { sendInvalid: true }));
    expect(emu.seen.length).toBe(before + 1);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.error?.name).toBe("InvalidParameterValue");
  });

  it("refuses an unknown service, operation or Region", async () => {
    await expect(send("Nope", "X", {})).rejects.toBeInstanceOf(BadSendRequest);
    await expect(send("SQS", "Nope", {})).rejects.toBeInstanceOf(BadSendRequest);
    await expect(sendOperation(emu.config, index, { sdkId: "SQS", operation: "ListQueues", region: "../x" })).rejects.toBeInstanceOf(BadSendRequest);
  });
});

describe("no answer", () => {
  it("gives up after the timeout and says the request may have arrived", async () => {
    emu.answer(() => ({ hang: true }));
    const o = await sendOperation(emu.config, index, { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" }, { timeoutMs: 150 });
    expect(o).toMatchObject({ kind: "no-response", reason: "timeout", mayHaveArrived: true });
  });

  it("stops when cancelled", async () => {
    emu.answer(() => ({ hang: true }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const o = await sendOperation(emu.config, index, { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" }, { signal: controller.signal });
    expect(o).toMatchObject({ kind: "no-response", reason: "cancelled" });
  });

  it("reports an Emulator nothing listens at as unreachable, with or without ca.pem", async () => {
    // A closed port with a run folder: the connection is refused.
    const closed = await sendOperation({ ...emu.config, emulatorPort: 1 }, index, { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" });
    expect(closed).toMatchObject({ kind: "no-response", reason: "unreachable", message: "The Emulator isn't answering." });
    const run = path.join(emu.home, "1");
    mkdirSync(run, { recursive: true });
    writeFileSync(path.join(run, "ca.pem"), readFileSync(path.join(emu.home, String(emu.config.emulatorPort), "ca.pem")));
    writeFileSync(path.join(run, "emulator_credentials"), `[default]\naws_access_key_id = ${FAKE_ACCESS_KEY}\naws_secret_access_key = ${FAKE_SECRET}\n`);
    const refused = await sendOperation({ ...emu.config, emulatorPort: 1 }, index, { sdkId: "SQS", operation: "ListQueues", region: "us-east-1" });
    expect(refused).toMatchObject({ kind: "no-response", reason: "unreachable", mayHaveArrived: false });
  });

  it("says no-ca for a running Emulator whose ca.pem is missing", async () => {
    const file = path.join(emu.home, String(emu.config.emulatorPort), "ca.pem");
    const keep = readFileSync(file);
    rmSync(file);
    try {
      expect(await send("SQS", "ListQueues", {})).toMatchObject({ kind: "no-response", reason: "no-ca" });
    } finally {
      writeFileSync(file, keep);
    }
  });
});

describe("credentials stay on the server", () => {
  it("never appear in a result, even when the Emulator echoes them", async () => {
    emu.answer((seen) => {
      const echoed = `${FAKE_SECRET} ${FAKE_ACCESS_KEY} ${seen.headers.authorization ?? ""}`;
      return { status: 400, headers: { "content-type": "application/x-amz-json-1.0", "x-echo": FAKE_SECRET }, body: JSON.stringify({ __type: "Oops", message: echoed }) };
    });
    const r = asResponse(await send("SQS", "ListQueues", {}));
    const text = JSON.stringify(r);
    expect(text.includes(FAKE_SECRET)).toBe(false);
    expect(text.includes(FAKE_ACCESS_KEY)).toBe(false);
    expect(r.raw.body).toContain("[redacted]");
  });

  it("never appear in the answer to a missing-file failure", async () => {
    const file = path.join(emu.home, String(emu.config.emulatorPort), "emulator_credentials");
    const keep = readFileSync(file);
    rmSync(file);
    try {
      const o = await send("SQS", "ListQueues", {});
      expect(o).toMatchObject({ kind: "no-response", reason: "no-credentials" });
      expect(JSON.stringify(o)).not.toContain(FAKE_SECRET);
      expect(JSON.stringify(o)).not.toContain(emu.home);
    } finally {
      writeFileSync(file, keep);
    }
  });

  it("are scrubbed from blob output, error details and serialization errors", async () => {
    // A stream/blob member holding the secret comes back base64: only a byte-level scrub can see it.
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ CiphertextBlob: Buffer.from(`xx${FAKE_SECRET}yy`).toString("base64"), KeyId: "k" }) }));
    const r = asResponse(await send("KMS", "Encrypt", { KeyId: "k", Plaintext: { text: "p" } }));
    const decoded = Buffer.from((r.output as { CiphertextBlob: string }).CiphertextBlob, "base64").toString();
    expect(decoded).toBe("xx[redacted]yy");
    expect(JSON.stringify(r).includes(FAKE_SECRET)).toBe(false);
    // An object body holding it, as text.
    emu.answer(() => ({ status: 200, headers: { "content-type": "application/x-amz-json-1.0" }, body: JSON.stringify({ QueueUrls: [FAKE_SECRET, FAKE_ACCESS_KEY] }) }));
    const t = asResponse(await send("SQS", "ListQueues", {}));
    expect(JSON.stringify(t).includes(FAKE_SECRET)).toBe(false);
    expect(JSON.stringify(t).includes(FAKE_ACCESS_KEY)).toBe(false);
    expect((t.output as { QueueUrls: string[] }).QueueUrls).toEqual(["[redacted]", "[redacted]"]);
  });
});
