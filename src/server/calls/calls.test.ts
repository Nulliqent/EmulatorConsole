import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CALL_LIMIT, type CallDetail } from "../../shared/calls.js";
import { ModelIndex } from "../model-index/index.js";
import { identify, virtualHostBucket } from "./identify.js";
import { classifyBody, recordExchange, type RawExchange } from "./record.js";
import { credentialScope, redactAuthorization, redactHeaders, redactQuery } from "./redact.js";
import { CallStore } from "./store.js";

let index: ModelIndex;
beforeAll(async () => {
  index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
});

const id = (over: Partial<Parameters<typeof identify>[1]>, host?: string) =>
  identify(index, { method: "POST", path: "/", query: [], headers: {}, body: "", ...over }, host);

describe("operation identification", () => {
  it("awsJson: from X-Amz-Target and the signing name", async () => {
    const r = await id({ headers: { "x-amz-target": "DynamoDB_20120810.PutItem" }, signingName: "dynamodb" });
    expect([r?.service.sdkId, r?.op.name]).toEqual(["DynamoDB", "PutItem"]);
    const sqs = await id({ headers: { "x-amz-target": "AmazonSQS.SendMessage" }, signingName: "sqs" });
    expect([sqs?.service.sdkId, sqs?.op.name]).toEqual(["SQS", "SendMessage"]);
    expect(await id({ headers: { "x-amz-target": "DynamoDB_20120810.NoSuchThing" }, signingName: "dynamodb" })).toBeUndefined();
  });

  it("awsQuery and ec2Query: from the Action parameter in the body or the query string", async () => {
    const form = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };
    const iam = await id({ headers: form, body: "Action=CreateUser&UserName=u&Version=2010-05-08", signingName: "iam" });
    expect([iam?.service.sdkId, iam?.op.name]).toEqual(["IAM", "CreateUser"]);
    const ec2 = await id({ method: "GET", query: [["Action", "DescribeInstances"]], signingName: "ec2" });
    expect([ec2?.service.sdkId, ec2?.op.name]).toEqual(["EC2", "DescribeInstances"]);
  });

  it("REST: from method, path and the query keys the template requires", async () => {
    const s3 = (method: string, p: string, query: [string, string][] = []) => id({ method, path: p, query, signingName: "s3" });
    expect((await s3("PUT", "/bk"))?.op.name).toBe("CreateBucket");
    expect((await s3("PUT", "/bk/dir/key.txt", [["x-id", "PutObject"]]))?.op.name).toBe("PutObject");
    expect((await s3("GET", "/bk/dir/key.txt", [["x-id", "GetObject"]]))?.op.name).toBe("GetObject");
    expect((await s3("GET", "/bk/key", [["acl", ""]]))?.op.name).toBe("GetObjectAcl");
    expect((await s3("HEAD", "/bk/key"))?.op.name).toBe("HeadObject");
    expect((await s3("GET", "/bk", [["list-type", "2"]]))?.op.name).toBe("ListObjectsV2");
    const lambda = await id({ method: "GET", path: "/2015-03-31/functions", signingName: "lambda" });
    expect([lambda?.service.sdkId, lambda?.op.name]).toEqual(["Lambda", "ListFunctions"]);
  });

  it("S3 virtual-host: the bucket comes from the Host", async () => {
    expect(virtualHostBucket("bk.localhost:19300")).toBe("bk");
    expect(virtualHostBucket("127.0.0.1:19300")).toBeUndefined();
    expect(virtualHostBucket("localhost:19300")).toBeUndefined();
    expect(virtualHostBucket("s3.amazonaws.com")).toBeUndefined();
    const r = await id({ method: "GET", path: "/dir/key.txt", query: [["x-id", "GetObject"]], signingName: "s3" }, "bk.localhost:19300");
    expect(r?.op.name).toBe("GetObject");
    expect(r?.pathPrefix).toEqual(["bk"]);
    expect((await id({ method: "GET", path: "/", query: [["list-type", "2"]], signingName: "s3" }, "bk.localhost:19300"))?.op.name).toBe("ListObjectsV2");
  });

  it("is undefined for an unknown service or when nothing matches", async () => {
    expect(await id({ headers: {}, signingName: "nope" })).toBeUndefined();
    expect(await id({ method: "GET", path: "/zzz/zzz/zzz/zzz", signingName: "lambda" })).toBeUndefined();
  });
});

describe("signatures and tokens", () => {
  const sig = "a".repeat(64);
  it("removes the signature, shortens the key id, drops tokens and unknown schemes", () => {
    const out = redactAuthorization(`AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261126/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=${sig}`);
    expect(out).toBe("AWS4-HMAC-SHA256 Credential=…MPLE/20261126/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=Not kept");
    expect(redactAuthorization("Bearer abc")).toBe("Not kept");
    const headers = redactHeaders([["X-Amz-Security-Token", "tok"], ["Cookie", "c"], ["Authorization", `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/d/r/s/aws4_request, Signature=${sig}`], ["Host", "h"]]);
    expect(JSON.stringify(headers)).not.toContain("tok");
    expect(JSON.stringify(headers)).not.toContain(sig);
    expect(headers.map(([n]) => n)).toEqual(["Authorization", "Host"]);
  });
  it("drops presigned signature parameters and reads the scope before it does", () => {
    const q: [string, string][] = [["X-Amz-Signature", sig], ["X-Amz-Security-Token", "t"], ["X-Amz-Credential", "AKIAIOSFODNN7EXAMPLE/20261126/eu-west-1/s3/aws4_request"], ["X-Amz-Expires", "60"]];
    expect(credentialScope(undefined, q[2]![1])).toEqual({ region: "eu-west-1", service: "s3" });
    expect(redactQuery(q)).toEqual([["X-Amz-Credential", "…MPLE/20261126/eu-west-1/s3/aws4_request"], ["X-Amz-Expires", "60"]]);
  });
});

describe("bodies", () => {
  const ct = (t: string): [string, string][] => [["Content-Type", t]];
  it("marks binary and encoded bodies and keeps no bytes of them (C5)", () => {
    expect(classifyBody(Buffer.from([0, 1, 2, 3]), 4, ct("application/octet-stream")).body).toEqual({ kind: "binary", size: 4, contentType: "application/octet-stream" });
    expect(classifyBody(Buffer.from("x"), 1, [["content-encoding", "gzip"]]).body).toMatchObject({ kind: "binary", encoding: "gzip" });
    expect(classifyBody(Buffer.from("abc"), 3, [["content-encoding", "aws-chunked"]]).body.text).toBeUndefined();
    expect(classifyBody(Buffer.from([0xff, 0xfe, 0x41]), 3, []).body.kind).toBe("binary");
    expect(classifyBody(Buffer.alloc(0), 0, []).body.kind).toBe("none");
  });
  it("cuts and says so (C4)", () => {
    const r = classifyBody(Buffer.from("héllo"), 1000, ct("text/plain"));
    expect(r.body).toMatchObject({ kind: "text", truncated: true, size: 1000 });
    expect(r.complete).toBe(false);
  });
});

function raw(over: Partial<RawExchange> = {}): RawExchange {
  return {
    startedAt: new Date("2026-11-26T10:00:00Z"),
    durationMs: 12,
    method: "POST",
    url: "/",
    requestHeaders: [],
    requestBody: Buffer.alloc(0),
    requestSize: 0,
    status: 200,
    responseHeaders: [],
    responseBody: Buffer.alloc(0),
    responseSize: 0,
    ...over,
  };
}

describe("recording a real model's sensitive members", () => {
  it("hides IAM CreateLoginProfile's Password in the request, keeps it for Show, and never stores the signature", async () => {
    const body = "Action=CreateLoginProfile&Version=2010-05-08&UserName=bob&Password=hunter2%21";
    const sig = "b".repeat(64);
    const { call, restore } = await recordExchange(
      index,
      raw({
        url: "/",
        requestHeaders: [["Content-Type", "application/x-www-form-urlencoded"], ["Authorization", `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/iam/aws4_request, SignedHeaders=host, Signature=${sig}`]],
        requestBody: Buffer.from(body),
        requestSize: body.length,
      }),
      { headersOnly: false },
    );
    expect(call).toMatchObject({ operation: "CreateLoginProfile", region: "us-east-1", hidden: 1 });
    expect(call.request.body.text).toBe("Action=CreateLoginProfile&Version=2010-05-08&UserName=bob&Password=Hidden");
    const store = new CallStore();
    store.add({ call, restore });
    expect(store.reveal(1)?.request.body.text).toBe(body);
    expect(JSON.stringify({ call, restore, shown: store.reveal(1) })).not.toContain(sig);
  });

  it("stores nothing extra when nothing is hidden", async () => {
    const r = await recordExchange(index, raw({ requestHeaders: [["x-amz-target", "DynamoDB_20120810.ListTables"], ["Authorization", "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/dynamodb/aws4_request, Signature=cc"]] }), { headersOnly: false });
    expect(r.restore).toBeUndefined();
    expect(r.call.operation).toBe("ListTables");
  });

  it("keeps the status and error body of a 501 unchanged", async () => {
    const body = '{"__type":"NotImplemented","message":"not implemented"}';
    const r = await recordExchange(
      index,
      raw({ requestHeaders: [["x-amz-target", "DynamoDB_20120810.ListTables"], ["Authorization", "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/dynamodb/aws4_request, Signature=cc"]], status: 501, responseBody: Buffer.from(body), responseSize: body.length }),
      { headersOnly: false },
    );
    expect(r.call.status).toBe(501);
    expect(r.call.response.body.text).toBe(body);
  });
});

describe("the Call store", () => {
  const call = (n: number): Omit<CallDetail, "id" | "run"> => ({
    startedAt: new Date(n).toISOString(), durationMs: 1, method: "GET", path: `/${n}`, query: "", status: 200, hidden: 0,
    request: { headers: [], body: { kind: "none", size: 0 } }, response: { headers: [], body: { kind: "none", size: 0 } },
  });

  it("keeps the latest calls, newest first, and says when it has removed older ones (C2)", () => {
    const s = new CallStore(3);
    for (let i = 1; i <= 5; i++) s.add({ call: call(i) });
    const r = s.list();
    expect(r.calls.map((c) => c.path)).toEqual(["/5", "/4", "/3"]);
    expect(r).toMatchObject({ total: 3, lastId: 5, limitReached: true, more: false });
    expect(s.get(1)).toBeUndefined();
    expect(CALL_LIMIT).toBe(5000);
  });

  it("pages with before and after", () => {
    const s = new CallStore(100);
    for (let i = 1; i <= 10; i++) s.add({ call: call(i) });
    expect(s.list({ limit: 3 })).toMatchObject({ more: true });
    expect(s.list({ limit: 3, before: 6 }).calls.map((c) => c.id)).toEqual([5, 4, 3]);
    expect(s.list({ after: 8 }).calls.map((c) => c.id)).toEqual([10, 9]);
  });

  it("notifies subscribers, groups Calls by Emulator Run, resets refusal counts with the run, and clears", () => {
    const s = new CallStore();
    const seen: number[] = [];
    const stop = s.subscribe((c) => seen.push(c.id));
    s.add({ call: call(1) });
    s.countBrowserRefusal();
    s.countTlsRefusal();
    s.startRun("2026-11-26T10:05:00Z");
    s.add({ call: call(2) });
    stop();
    s.add({ call: call(3) });
    expect(seen).toEqual([1, 2]);
    expect(s.list().calls.map((c) => c.run)).toEqual([2, 2, 1]);
    expect(s.list({ run: 1 }).calls).toHaveLength(1);
    expect(s.list().runs.map((r) => r.id)).toEqual([1, 2]);
    expect(s.browserRefusals.count).toBe(0);
    expect(s.tlsRefusals.count).toBe(0);
    expect(s.clear()).toBe(3);
    expect(s.total).toBe(0);
    expect(s.lastId).toBe(3);
  });

  it("returns hidden values only from reveal", () => {
    const s = new CallStore();
    const masked = { ...call(1), hidden: 1, path: "/Hidden" };
    s.add({ call: masked, restore: { path: "/secret" } });
    expect(s.get(1)?.path).toBe("/Hidden");
    expect(s.reveal(1)?.path).toBe("/secret");
  });
});
