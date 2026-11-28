import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ModelIndex } from "../model-index/index.js";
import { identify, virtualHostBucket } from "./identify.js";
import { recordExchange, type RawExchange } from "./record.js";
import { redactAuthorization, redactHeaders, redactQuery, stripSecretValues } from "./redact.js";
import { CallStore } from "./store.js";

let index: ModelIndex;
beforeAll(async () => {
  index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
});

const AUTH = (service: string) => `AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/${service}/aws4_request, SignedHeaders=host, Signature=${"d".repeat(64)}`;
const buf = (s: string) => Buffer.from(s);

function raw(over: Partial<RawExchange> = {}): RawExchange {
  return {
    startedAt: new Date("2026-11-26T10:00:00Z"), durationMs: 5, method: "POST", url: "/", requestHeaders: [], requestBody: Buffer.alloc(0), requestSize: 0,
    status: 200, responseHeaders: [], responseBody: Buffer.alloc(0), responseSize: 0, ...over,
  };
}
const withBodies = (req: string, res: string, over: Partial<RawExchange> = {}) =>
  raw({ requestBody: buf(req), requestSize: req.length, responseBody: buf(res), responseSize: res.length, ...over });

/** Records, stores, and returns what the browser would get from `get` and from `reveal`. */
async function recorded(r: RawExchange, headersOnly = false) {
  const store = new CallStore();
  store.add(await recordExchange(index, r, { headersOnly }));
  return { shown: store.get(1)!, revealed: store.reveal(1)!, summary: store.list().calls[0]! };
}
const everything = (...v: unknown[]) => JSON.stringify(v);

describe("EC2 private keys (blocking 1)", () => {
  it("hides CreateKeyPair's keyMaterial, named by the raw xmlName in the response, and Show returns it", async () => {
    const res = "<CreateKeyPairResponse><requestId>r</requestId><keyFingerprint>aa:bb</keyFingerprint><keyMaterial>-----BEGIN RSA PRIVATE KEY-----SECRETKEY</keyMaterial><keyName>k</keyName></CreateKeyPairResponse>";
    const r = await recorded(withBodies("Action=CreateKeyPair&KeyName=k&Version=2016-11-15", res, { requestHeaders: [["content-type", "application/x-www-form-urlencoded"], ["authorization", AUTH("ec2")]], responseHeaders: [["content-type", "text/xml"]] }));
    expect(r.summary).toMatchObject({ operation: "CreateKeyPair", service: { sdkId: "EC2" } });
    expect(r.shown.response.body.text).toBe("<CreateKeyPairResponse><requestId>r</requestId><keyFingerprint>aa:bb</keyFingerprint><keyMaterial>Hidden</keyMaterial><keyName>k</keyName></CreateKeyPairResponse>");
    expect(everything(r.shown)).not.toContain("SECRETKEY");
    expect(r.revealed.response.body.text).toBe(res);
  });
});

describe("unsigned query calls (blocking 2)", () => {
  it("identifies STS AssumeRoleWithWebIdentity with no signing scope, and keeps the session token out of both copies", async () => {
    const req = "Action=AssumeRoleWithWebIdentity&Version=2011-06-15&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2Fr&RoleSessionName=s&WebIdentityToken=JWTSECRETVALUE";
    const res = "<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIA1</AccessKeyId><SecretAccessKey>SECRETACCESS</SecretAccessKey><SessionToken>SESSIONTOKENVALUE</SessionToken><Expiration>x</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>";
    const r = await recorded(withBodies(req, res, { requestHeaders: [["content-type", "application/x-www-form-urlencoded"]] }));
    expect(r.summary).toMatchObject({ operation: "AssumeRoleWithWebIdentity", service: { sdkId: "STS" } });
    for (const copy of [r.shown, r.revealed]) {
      expect(everything(copy)).not.toContain("SESSIONTOKENVALUE");
      expect(copy.response.body.text).toContain("<SessionToken>Not kept</SessionToken>");
    }
    expect(everything(r.shown)).not.toContain("SECRETACCESS");
    expect(everything(r.shown)).not.toContain("JWTSECRETVALUE");
    expect(r.revealed.response.body.text).toContain("SECRETACCESS");
    expect(r.revealed.request.body.text).toContain("JWTSECRETVALUE");
  });
});

describe("session tokens and signatures in bodies (blocking 3)", () => {
  it("drops SessionToken keys and elements, multipart signature parts and SigV2 parameters", () => {
    expect(stripSecretValues('{"Credentials":{"SessionToken":"abc","x":1},"roleCredentials":{"sessionToken":"def\\"q"}}')).toBe('{"Credentials":{"SessionToken":"Not kept","x":1},"roleCredentials":{"sessionToken":"Not kept"}}');
    expect(stripSecretValues("<a><SessionToken>zzz</SessionToken></a>")).toBe("<a><SessionToken>Not kept</SessionToken></a>");
    const form = ['--B', 'Content-Disposition: form-data; name="key"', "", "k", "--B", 'Content-Disposition: form-data; name="X-Amz-Signature"', "", "SIGVALUE", "--B", 'Content-Disposition: form-data; name="x-amz-security-token"', "", "TOKVALUE", "--B--", ""].join("\r\n");
    const out = stripSecretValues(form);
    expect(out).not.toContain("SIGVALUE");
    expect(out).not.toContain("TOKVALUE");
    expect(out).toContain('name="key"\r\n\r\nk');
    expect(stripSecretValues("Action=X&Signature=abc&SecurityToken=t&Foo=bar")).not.toMatch(/abc|=t&/);
    expect(redactQuery([["SecurityToken", "t"], ["Signature", "s"], ["Action", "X"]])).toEqual([["Action", "X"]]);
  });

  it("keeps a Cognito GetCredentialsForIdentity session token out of every copy", async () => {
    const res = '{"IdentityId":"i","Credentials":{"AccessKeyId":"A","SecretKey":"SECRETKEYVALUE","SessionToken":"COGNITOTOKEN","Expiration":1}}';
    const r = await recorded(withBodies('{"IdentityId":"i"}', res, { requestHeaders: [["x-amz-target", "AWSCognitoIdentityService.GetCredentialsForIdentity"], ["authorization", AUTH("cognito-identity")]] }));
    expect(r.summary.operation).toBe("GetCredentialsForIdentity");
    expect(everything(r.shown, r.revealed)).not.toContain("COGNITOTOKEN");
  });

  it("keeps the signature of an S3 POST policy form out of every copy", async () => {
    const form = ['--B', 'Content-Disposition: form-data; name="x-amz-signature"', "", "POSTSIG", "--B--", ""].join("\r\n");
    const r = await recorded(withBodies(form, "", { url: "/bk", requestHeaders: [["content-type", "multipart/form-data; boundary=B"], ["authorization", AUTH("s3")]], status: 204 }));
    expect(everything(r.shown, r.revealed)).not.toContain("POSTSIG");
  });

  it("cuts everything after Signature, however it is spaced", () => {
    expect(redactAuthorization(`AWS4-HMAC-SHA256 Credential = AKIAEXAMPLEKEY123/d/r/s/aws4_request , SignedHeaders=host , Signature = ${"e".repeat(64)} , Extra=1`)).not.toMatch(/e{20}/);
    expect(redactHeaders([["X-Amz-S3session-Token", "t"]])).toEqual([]);
  });
});

describe("operations on / and other REST gaps (blocking 4, 6)", () => {
  const id = (over: object, host?: string) => identify(index, { method: "GET", path: "/", query: [], headers: {}, body: "", signingName: "s3", ...over }, host);
  it("identifies S3 ListBuckets on /", async () => {
    expect((await id({}))?.op.name).toBe("ListBuckets");
    expect((await id({}, "bk.localhost:19300"))?.op.name).toBe("ListObjects");
  });
  it("identifies S3 object operations without x-id, and prefers it when present", async () => {
    expect((await id({ path: "/bk/k" }))?.op.name).toBe("GetObject");
    expect((await id({ method: "PUT", path: "/bk/k" }))?.op.name).toBe("PutObject");
    expect((await id({ method: "PUT", path: "/bk/k", query: [["x-id", "CopyObject"]] }))?.op.name).toBe("CopyObject");
    expect((await id({ path: "/bk/k", query: [["acl", ""]] }))?.op.name).toBe("GetObjectAcl");
  });
  it("hides an SSE-C key by name, even when the Call can't be identified", async () => {
    const r = await recorded(raw({ method: "PUT", url: "/not/a/known/thing", requestHeaders: [["x-amz-server-side-encryption-customer-key", "KEYBASE64"], ["x-amz-copy-source-server-side-encryption-customer-key", "KEY2"]] }));
    expect(everything(r.shown)).not.toContain("KEYBASE64");
    expect(r.shown.request.headers.map(([, v]) => v)).toEqual(["Hidden", "Hidden"]);
    expect(r.revealed.request.headers.map(([, v]) => v)).toEqual(["KEYBASE64", "KEY2"]);
  });
});

describe("protocols (blocking 5)", () => {
  it("identifies an rpcv2Cbor operation by the service's protocols list", async () => {
    const svc = index.services().find((s) => s.protocols.includes("rpcv2Cbor"))!;
    const detail = (await index.detail(svc.sdkId))!;
    const op = detail.operations[0]!;
    const r = await identify(index, { method: "POST", path: `/service/${svc.shapeId.replace(/^.*#/, "")}/operation/${op.name}`, query: [], headers: {}, body: "" });
    expect(r).toMatchObject({ wire: "rpcv2Cbor" });
    expect(r?.op.name).toBe(op.name);
  });
  it("sees an awsQuery request to a JSON service (SQS) as awsQuery on the wire", async () => {
    const r = await identify(index, { method: "POST", path: "/", query: [], headers: { "content-type": "application/x-www-form-urlencoded" }, body: "Action=SendMessage&QueueUrl=x&MessageBody=b", signingName: "sqs" });
    expect(r).toMatchObject({ wire: "awsQuery" });
    expect(r?.service.sdkId).toBe("SQS");
  });
});

describe("failing closed (10)", () => {
  it("withholds bodies when the index didn't load, and Show returns them", async () => {
    const store = new CallStore();
    store.add(await recordExchange(null, withBodies('{"a":"SECRETBODY"}', '{"b":"SECRETRESP"}', { requestHeaders: [["x-amz-target", "X.Y"]] }), { headersOnly: false }));
    const shown = store.get(1)!;
    expect(shown.request.body.kind).toBe("withheld");
    expect(shown.response.body.kind).toBe("withheld");
    expect(everything(shown)).not.toMatch(/SECRET/);
    expect(store.reveal(1)!.request.body.text).toBe('{"a":"SECRETBODY"}');
  });
  it("withholds bodies signed for a known service when no operation matched", async () => {
    const r = await recorded(withBodies("data", "more", { method: "PATCH", url: "/zz/zz/zz/zz", requestHeaders: [["authorization", AUTH("s3")]] }));
    expect(r.shown.request.body.kind).toBe("withheld");
    expect(r.revealed.request.body.text).toBe("data");
  });
  it("shows bodies of a Call from a service the index has never heard of", async () => {
    const r = await recorded(withBodies("data", "more", { requestHeaders: [["authorization", AUTH("nothing-like-this")]] }));
    expect(r.shown.request.body.text).toBe("data");
  });
});

describe("classification at record time (12)", () => {
  const dynamo = [["x-amz-target", "DynamoDB_20120810.GetItem"], ["authorization", AUTH("dynamodb")]] as [string, string][];
  it("records the code, whether the model declares it, and the Emulator Gap rule", async () => {
    const declared = await recorded(withBodies("{}", '{"__type":"com.amazonaws.dynamodb.v20120810#ResourceNotFoundException","message":"m"}', { status: 400, requestHeaders: dynamo }));
    expect(declared.summary).toMatchObject({ errorCode: "ResourceNotFoundException", declared: true, emulatorGap: false });
    const gap = await recorded(withBodies("{}", '{"__type":"NotImplemented","message":"x is scaffolded but not implemented in this emulator"}', { status: 501, requestHeaders: dynamo }));
    expect(gap.summary).toMatchObject({ status: 501, errorCode: "NotImplemented", declared: false, emulatorGap: true });
    const ok = await recorded(withBodies("{}", "{}", { requestHeaders: dynamo }));
    expect(ok.summary.errorCode).toBeUndefined();
    expect(ok.summary.emulatorGap).toBeUndefined();
  });
  it("still classifies with headers and status only, and when the body is withheld", async () => {
    const r = await recorded(withBodies("{}", '{"__type":"NotImplemented"}', { status: 501, requestHeaders: dynamo }), true);
    expect(r.summary).toMatchObject({ errorCode: "NotImplemented", emulatorGap: true });
    expect(r.shown.response.body.kind).toBe("not-recorded");
    const withheld = await recordExchange(null, withBodies("{}", '{"__type":"NotImplemented"}', { status: 501 }), { headersOnly: false });
    expect(withheld.call).toMatchObject({ errorCode: "NotImplemented", emulatorGap: true });
  });
  it("separates a client that left from an Emulator that didn't answer", async () => {
    expect((await recorded(raw({ status: 0, error: "client-aborted" }))).summary.error).toBe("client-aborted");
    expect((await recorded(raw({ status: 0, error: "emulator-unreachable" }))).summary.error).toBe("emulator-unreachable");
  });
});

describe("binary bodies (19)", () => {
  const bytes = Buffer.from([0, 1, 2, 3, 255]);
  it("keeps the bytes of a binary S3 body when nothing in the operation is sensitive", async () => {
    const r = await recorded(raw({ method: "GET", url: "/bk/k", requestHeaders: [["authorization", AUTH("s3")]], responseBody: bytes, responseSize: 5, responseHeaders: [["content-type", "application/octet-stream"]] }));
    expect(r.shown.response.body).toMatchObject({ kind: "binary", size: 5, base64: bytes.toString("base64") });
  });
  it("keeps no bytes of an aws-chunked body (its chunks carry signatures) or of an unidentified Call", async () => {
    const chunked = await recorded(raw({ method: "PUT", url: "/bk/k", requestHeaders: [["authorization", AUTH("s3")], ["content-encoding", "aws-chunked"]], requestBody: buf("5;chunk-signature=abc\r\nhello"), requestSize: 30 }));
    expect(chunked.shown.request.body.base64).toBeUndefined();
    expect(chunked.shown.request.body.kind).toBe("binary");
    const unknown = await recorded(raw({ responseBody: bytes, responseSize: 5 }));
    expect(unknown.shown.response.body.base64).toBeUndefined();
  });
});

describe("virtual-host names (13)", () => {
  it("counts only localhost, an S3 endpoint or the Gateway's own names", () => {
    expect(virtualHostBucket("bk.localhost:9300")).toBe("bk");
    expect(virtualHostBucket("bk.s3.us-east-1.amazonaws.com")).toBe("bk");
    expect(virtualHostBucket("bk.host.docker.internal:9300", ["host.docker.internal"])).toBe("bk");
    expect(virtualHostBucket("bk.host.docker.internal:9300")).toBeUndefined();
    expect(virtualHostBucket("host.docker.internal:9300")).toBeUndefined();
    expect(virtualHostBucket("a.example.com")).toBeUndefined();
  });
});

describe("the memory budget (8)", () => {
  it("drops the oldest Calls' bodies and keeps their summaries, then says the limit was reached", async () => {
    const store = new CallStore(5000, () => new Date(), 3000);
    const big = "x".repeat(1000);
    for (let i = 0; i < 6; i++) {
      store.add(await recordExchange(index, withBodies(big, big, { requestHeaders: [["authorization", AUTH("nothing-like-this")]] }), { headersOnly: false }));
    }
    expect(store.heldBytes).toBeLessThanOrEqual(3000);
    expect(store.total).toBe(6);
    expect(store.get(1)!.request.body).toMatchObject({ kind: "removed", size: 1000 });
    expect(store.get(1)!.request.headers.length).toBeGreaterThan(0);
    expect(store.get(6)!.request.body.kind).toBe("text");
    expect(store.list().limitReached).toBe(true);
    expect(store.reveal(1)!.request.body.kind).toBe("removed");
  });
  it("holds the original text of what was hidden, not a second copy of the Call", async () => {
    const body = "Action=CreateLoginProfile&Version=2010-05-08&UserName=bob&Password=hunter2";
    const rec = await recordExchange(index, withBodies(body, "", { requestHeaders: [["content-type", "application/x-www-form-urlencoded"], ["authorization", AUTH("iam")]] }), { headersOnly: false });
    expect(rec.restore).toEqual({ requestBody: [{ start: expect.any(Number), end: expect.any(Number), text: "hunter2" }] });
  });
});
