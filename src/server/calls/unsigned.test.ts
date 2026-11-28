import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ModelIndex } from "../model-index/index.js";
import { recordExchange, type RawExchange } from "./record.js";
import { redactQuery, stripSecretValues } from "./redact.js";
import { CallStore } from "./store.js";

let index: ModelIndex;
beforeAll(async () => {
  index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
}, 60_000);

const buf = (s: string) => Buffer.from(s);
function raw(over: Partial<RawExchange> = {}): RawExchange {
  return {
    startedAt: new Date("2026-11-26T10:00:00Z"), durationMs: 5, method: "POST", url: "/", requestHeaders: [], requestBody: Buffer.alloc(0), requestSize: 0,
    status: 200, responseHeaders: [], responseBody: Buffer.alloc(0), responseSize: 0, ...over,
  };
}
const withBodies = (req: string, res: string, over: Partial<RawExchange> = {}) =>
  raw({ requestBody: buf(req), requestSize: req.length, responseBody: buf(res), responseSize: res.length, ...over });
async function recorded(r: RawExchange) {
  const store = new CallStore();
  store.add(await recordExchange(index, r, { headersOnly: false }));
  return { shown: store.get(1)!, revealed: store.reveal(1)!, summary: store.list().calls[0]! };
}
const all = (...v: unknown[]) => JSON.stringify(v);

describe("unsigned REST Calls (B1)", () => {
  it("identifies SSO GetRoleCredentials with no signing name, hides its token and secret, and never keeps the session token", async () => {
    const res = '{"roleCredentials":{"accessKeyId":"ASIAEXAMPLE","secretAccessKey":"SECRETACCESSVALUE","sessionToken":"SSOSESSIONTOKEN","expiration":1}}';
    const r = await recorded(
      withBodies("", res, {
        method: "GET",
        url: "/federation/credentials?role_name=r&account_id=123456789012",
        requestHeaders: [["x-amz-sso_bearer_token", "BEARERTOKENVALUE"]],
        responseHeaders: [["content-type", "application/json"]],
      }),
    );
    expect(r.summary).toMatchObject({ operation: "GetRoleCredentials", service: { sdkId: "SSO" } });
    expect(all(r.shown)).not.toMatch(/BEARERTOKENVALUE|SECRETACCESSVALUE|SSOSESSIONTOKEN/);
    expect(all(r.revealed)).not.toContain("SSOSESSIONTOKEN");
    expect(r.revealed.request.headers.find(([n]) => n === "x-amz-sso_bearer_token")![1]).toBe("BEARERTOKENVALUE");
    expect(r.revealed.response.body.text).toContain("SECRETACCESSVALUE");
  });

  it("identifies SSO OIDC CreateToken (POST /token) and hides the client secret and every token", async () => {
    const req = '{"clientId":"cid","clientSecret":"CLIENTSECRETVALUE","grantType":"authorization_code","code":"AUTHCODEVALUE"}';
    const res = '{"accessToken":"ACCESSTOKENVALUE","refreshToken":"REFRESHTOKENVALUE","idToken":"IDTOKENVALUE","tokenType":"Bearer","expiresIn":3600}';
    const r = await recorded(withBodies(req, res, { url: "/token", requestHeaders: [["content-type", "application/json"]], responseHeaders: [["content-type", "application/json"]] }));
    expect(r.summary).toMatchObject({ operation: "CreateToken", service: { sdkId: "SSO OIDC" } });
    expect(all(r.shown)).not.toMatch(/CLIENTSECRETVALUE|ACCESSTOKENVALUE|REFRESHTOKENVALUE|IDTOKENVALUE/);
    expect(r.revealed.response.body.text).toContain("ACCESSTOKENVALUE");
  });

  it("withholds the bodies of an unsigned Call it can't identify: an unknown Action and an unknown X-Amz-Target", async () => {
    const form = await recorded(withBodies("Action=Bogus&Secret=FORMSECRET", "<r>RESPSECRET</r>", { requestHeaders: [["content-type", "application/x-www-form-urlencoded"]] }));
    expect(form.shown.request.body.kind).toBe("withheld");
    expect(form.shown.response.body.kind).toBe("withheld");
    expect(all(form.shown)).not.toMatch(/FORMSECRET|RESPSECRET/);
    expect(form.revealed.request.body.text).toContain("FORMSECRET");

    const target = await recorded(withBodies('{"k":"TARGETSECRET"}', '{"v":"TARGETRESP"}', { requestHeaders: [["x-amz-target", "Nope_1.DoIt"]] }));
    expect(target.shown.request.body.kind).toBe("withheld");
    expect(all(target.shown)).not.toMatch(/TARGETSECRET|TARGETRESP/);
    expect(target.revealed.response.body.text).toBe('{"v":"TARGETRESP"}');

    const rest = await recorded(withBodies("REQSECRET", "RESSECRET", { method: "PUT", url: "/no/such/route/anywhere" }));
    expect(rest.shown.request.body.kind).toBe("withheld");
  });

  it("hides the SSO bearer token by name when the Call can't be identified", async () => {
    const r = await recorded(raw({ method: "GET", url: "/zz/zz/zz", requestHeaders: [["X-Amz-Sso_Bearer_Token", "BEARER2"]] }));
    expect(all(r.shown)).not.toContain("BEARER2");
  });
});

describe("encoded bodies keep no bytes (N1)", () => {
  const authS3 = "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/s3/aws4_request, Signature=aa";
  it("never keeps base64 of a gzip, deflate or br body, or of bytes that look like a token", async () => {
    for (const enc of ["gzip", "deflate", "br"]) {
      const r = await recorded(raw({ method: "GET", url: "/bk/k", requestHeaders: [["authorization", authS3]], responseBody: Buffer.from([0x1f, 0x8b, 0, 1]), responseSize: 4, responseHeaders: [["content-encoding", enc]] }));
      expect(r.shown.response.body).toMatchObject({ kind: "binary", encoding: enc });
      expect(r.shown.response.body.base64).toBeUndefined();
    }
    const secretish = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('"SessionToken":"x"')]);
    const r = await recorded(raw({ method: "GET", url: "/bk/k", requestHeaders: [["authorization", authS3]], responseBody: secretish, responseSize: secretish.length }));
    expect(r.shown.response.body.base64).toBeUndefined();
    const plain = await recorded(raw({ method: "GET", url: "/bk/k", requestHeaders: [["authorization", authS3]], responseBody: Buffer.from([0, 1, 2, 3]), responseSize: 4 }));
    expect(plain.shown.response.body.base64).toBe("AAECAw==");
  });
});

describe("the access key id is shortened wherever it appears (N2)", () => {
  const KEY = "AKIAIOSFODNN7EXAMPLE";
  it("in query strings, SigV2 form bodies and multipart parts", () => {
    expect(redactQuery([["X-Amz-Credential", `${KEY}/20261126/us-east-1/s3/aws4_request`], ["AWSAccessKeyId", KEY], ["Expires", "1"]])).toEqual([
      ["X-Amz-Credential", "…MPLE/20261126/us-east-1/s3/aws4_request"],
      ["AWSAccessKeyId", "…MPLE"],
      ["Expires", "1"],
    ]);
    const form = stripSecretValues(`Action=X&AWSAccessKeyId=${KEY}&Signature=sig&Foo=1`);
    expect(form).not.toContain(KEY);
    expect(form).toContain(encodeURIComponent("…MPLE"));
    const multi = ["--B", 'Content-Disposition: form-data; name="x-amz-credential"', "", `${KEY}/20261126/us-east-1/s3/aws4_request`, "--B", 'Content-Disposition: form-data; name="AWSAccessKeyId"', "", KEY, "--B--", ""].join("\r\n");
    const out = stripSecretValues(multi);
    expect(out).not.toContain(KEY);
    expect(out).toContain("…MPLE/20261126/us-east-1/s3/aws4_request");
  });
  it("end to end: a presigned URL's stored query has no full key", async () => {
    const r = await recorded(raw({ method: "GET", url: `/bk/k?X-Amz-Credential=${encodeURIComponent(`${KEY}/20261126/us-east-1/s3/aws4_request`)}&X-Amz-Signature=${"c".repeat(64)}&X-Amz-Expires=60` }));
    expect(all(r.shown, r.revealed)).not.toContain(KEY);
    expect(all(r.shown, r.revealed)).not.toContain("c".repeat(64));
    expect(r.summary.region).toBe("us-east-1");
  });
});

describe("the budget counts bytes (N3)", () => {
  it("counts UTF-8 bytes, headers and paths, not characters", async () => {
    const wide = "é".repeat(500); // 500 characters, 1,000 bytes
    const store = new CallStore(5000, () => new Date(), 10_000_000);
    store.add(await recordExchange(index, withBodies(wide, "", { url: "/zz-unknown", requestHeaders: [["authorization", "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/nothing-like-this/aws4_request, Signature=aa"], ["x-long", "h".repeat(300)]] }), { headersOnly: false }));
    expect(store.heldBytes).toBeGreaterThanOrEqual(1000 + 300 + "/zz-unknown".length);
    expect(store.heldBytes).toBeLessThan(2000);
  });
  it("keeps a trimmed Call's headers in the count", async () => {
    const store = new CallStore(5000, () => new Date(), 1500);
    const rec = () => recordExchange(index, withBodies("x".repeat(1000), "", { requestHeaders: [["authorization", "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY123/20261126/us-east-1/nothing-like-this/aws4_request, Signature=aa"], ["x-long", "h".repeat(400)]] }), { headersOnly: false });
    store.add(await rec());
    store.add(await rec());
    expect(store.get(1)!.request.body.kind).toBe("removed");
    expect(store.heldBytes).toBeGreaterThan(400 * 2);
  });
});
