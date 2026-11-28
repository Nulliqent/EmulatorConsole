import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { CreateQueueCommand, DeleteQueueCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { GetSessionTokenCommand, STSClient } from "@aws-sdk/client-sts";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { beforeAll, describe, expect, it } from "vitest";
import type { CallDetail, CallsResponse, GatewayStatus } from "../src/shared/calls.js";

// The shared e2e stack (scripts/e2e.sh up): Emulator 19297, Console 19298, Gateway 19300.
const CONSOLE = 19298;
const GATEWAY = 19300;
const RUN_DIR = path.resolve(import.meta.dirname, "..", ".aws", "e2e", "19297");

function keys() {
  const lines = readFileSync(path.join(RUN_DIR, "emulator_credentials"), "utf8").split("\n");
  const pairs = lines.map((l) => /^\s*([\w.-]+)\s*=\s*(\S+)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1]!, m[2]!] as const);
  const find = (re: RegExp) => pairs.find(([k]) => re.test(k))?.[1];
  const accessKeyId = find(/key_?id/i) ?? pairs[0]![1];
  const secretAccessKey = find(/secret/i) ?? pairs[1]![1];
  return { accessKeyId, secretAccessKey };
}

function consoleApi<T>(method: "GET" | "POST", p: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; json: T; text: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: CONSOLE, path: p, method, headers: { host: `127.0.0.1:${CONSOLE}`, ...(method === "POST" ? { origin: `http://127.0.0.1:${CONSOLE}`, "content-type": "application/json" } : {}), ...headers } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text, json: (text.startsWith("{") ? JSON.parse(text) : undefined) as T }));
      },
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function calls() {
  // Calls are recorded just after the response ends.
  await new Promise((r) => setTimeout(r, 300));
  return (await consoleApi<CallsResponse>("GET", "/api/calls?limit=500")).json.calls;
}

const retry = async <T>(fn: () => Promise<T>) => {
  let last: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw last;
};

const s3 = (over: ConstructorParameters<typeof S3Client>[0] = {}) =>
  new S3Client({ region: "us-east-1", endpoint: `http://127.0.0.1:${GATEWAY}`, forcePathStyle: true, credentials: keys(), ...over });

beforeAll(async () => {
  expect((await consoleApi<GatewayStatus>("GET", "/api/gateway")).json.state).toBe("listening");
  await consoleApi("POST", "/api/calls/clear", {});
});

describe("an SDK pointed at the Gateway", () => {
  it("works for S3 in path style, and each Call is identified", async () => {
    const c = s3();
    const bucket = `gw-path-${Date.now()}`;
    await retry(() => c.send(new CreateBucketCommand({ Bucket: bucket })));
    await c.send(new PutObjectCommand({ Bucket: bucket, Key: "dir/hello.txt", Body: "hello gateway", ContentType: "text/plain" }));
    const got = await c.send(new GetObjectCommand({ Bucket: bucket, Key: "dir/hello.txt" }));
    expect(await got.Body!.transformToString()).toBe("hello gateway");
    const list = await c.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(list.Contents?.map((o) => o.Key)).toEqual(["dir/hello.txt"]);

    const ops = (await calls()).filter((x) => x.path.includes(bucket)).map((x) => x.operation);
    expect(ops).toEqual(expect.arrayContaining(["CreateBucket", "PutObject", "GetObject", "ListObjectsV2"]));
    const put = (await calls()).find((x) => x.operation === "PutObject" && x.path.includes(bucket))!;
    expect(put).toMatchObject({ service: { sdkId: "S3" }, region: "us-east-1", method: "PUT", status: 200 });

    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: "dir/hello.txt" }));
    await c.send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  it("works for S3 in virtual-host style (bucket in the Host)", async () => {
    const lookup = (_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) =>
      o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
    const agent = new http.Agent({ lookup } as http.AgentOptions);
    const { NodeHttpHandler } = await import("@smithy/node-http-handler");
    const c = s3({ endpoint: `http://localhost:${GATEWAY}`, forcePathStyle: false, requestHandler: new NodeHttpHandler({ httpAgent: agent }) });
    const bucket = `gw-vhost-${Date.now()}`;
    // The Emulator reads a bucket from the Host only for a bucket it holds, so the bucket is made path-style first.
    await retry(() => s3().send(new CreateBucketCommand({ Bucket: bucket })));
    await c.send(new PutObjectCommand({ Bucket: bucket, Key: "v.txt", Body: "virtual" }));
    const got = await c.send(new GetObjectCommand({ Bucket: bucket, Key: "v.txt" }));
    expect(await got.Body!.transformToString()).toBe("virtual");
    const recorded = (await calls()).find((x) => x.operation === "GetObject" && x.path === "/v.txt");
    expect(recorded).toBeDefined();
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: "v.txt" }));
    await s3().send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  it("works for SQS, including calls that use the QueueUrl the Emulator returned", async () => {
    const c = new SQSClient({ region: "us-east-1", endpoint: `http://127.0.0.1:${GATEWAY}`, credentials: keys() });
    const name = `gw-q-${Date.now()}`;
    const { QueueUrl } = await retry(() => c.send(new CreateQueueCommand({ QueueName: name })));
    expect(QueueUrl).toBeTruthy();
    await c.send(new SendMessageCommand({ QueueUrl, MessageBody: "via gateway" }));
    const got = await c.send(new ReceiveMessageCommand({ QueueUrl, WaitTimeSeconds: 1 }));
    expect(got.Messages?.[0]?.Body).toBe("via gateway");
    await c.send(new DeleteQueueCommand({ QueueUrl }));
    const ops = (await calls()).map((x) => x.operation);
    expect(ops).toEqual(expect.arrayContaining(["CreateQueue", "SendMessage", "ReceiveMessage", "DeleteQueue"]));
  });

  it("serves a presigned S3 URL", async () => {
    const c = s3();
    const bucket = `gw-presign-${Date.now()}`;
    await retry(() => c.send(new CreateBucketCommand({ Bucket: bucket })));
    await c.send(new PutObjectCommand({ Bucket: bucket, Key: "p.txt", Body: "presigned body" }));
    const url = await getSignedUrl(c, new GetObjectCommand({ Bucket: bucket, Key: "p.txt" }), { expiresIn: 60 });
    expect(url).toContain(`127.0.0.1:${GATEWAY}`);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("presigned body");
    const stored = (await calls()).find((x) => x.operation === "GetObject" && x.path.includes("p.txt"));
    expect(stored?.query).not.toMatch(/signature/i);
    expect(stored?.query.includes(keys().accessKeyId), "the full access key id is stored").toBe(false);
    await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: "p.txt" }));
    await c.send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  it("stores no signature and no session token", async () => {
    const token = "SessionTokenValueForTheE2eTest0123456789abcdef";
    const seen: string[] = [];
    const c = s3({ credentials: { ...keys(), sessionToken: token } });
    // After signing: record what the SDK actually sent.
    c.middlewareStack.add(
      (next) => async (args) => {
        const h = (args.request as { headers: Record<string, string> }).headers;
        seen.push(h["authorization"] ?? "", h["x-amz-security-token"] ?? "");
        return next(args);
      },
      { step: "finalizeRequest", name: "capture", priority: "low" },
    );
    const bucket = `gw-sig-${Date.now()}`;
    await c.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined); // the Emulator may refuse an unknown token; the Call is recorded either way
    await c.send(new PutObjectCommand({ Bucket: bucket, Key: "k", Body: "x" })).catch(() => undefined);
    const signature = /Signature=([0-9a-f]{64})/.exec(seen.join(" "))?.[1];
    expect(signature, "the SDK signed the request").toBeDefined();
    expect(seen.includes(token) || seen.some((s) => s === token)).toBe(true);

    const list = await calls();
    expect(list.length).toBeGreaterThan(0);
    let everything = JSON.stringify(list);
    for (const summary of list) {
      const detail = (await consoleApi<{ call: CallDetail }>("GET", `/api/calls/get?id=${summary.id}`)).text;
      const shown = (await consoleApi<{ call: CallDetail }>("POST", "/api/calls/reveal", { id: summary.id }, { "x-console": "1" })).text;
      everything += detail + shown;
    }
    // Booleans, so a failure never prints the values.
    expect(everything.includes(signature!), "a stored Call contains the signature").toBe(false);
    expect(everything.includes(token), "a stored Call contains the session token").toBe(false);
    expect(everything.includes(keys().secretAccessKey), "a stored Call contains the secret key").toBe(false);
  });

  it("keeps the session token an STS call returns out of every copy", async () => {
    const c = new STSClient({ region: "us-east-1", endpoint: `http://127.0.0.1:${GATEWAY}`, credentials: keys() });
    const out = await c.send(new GetSessionTokenCommand({ DurationSeconds: 900 })).catch(() => undefined);
    const token = out?.Credentials?.SessionToken;
    const secret = out?.Credentials?.SecretAccessKey;
    const list = await calls();
    const call = list.find((x) => x.operation === "GetSessionToken");
    expect(call, "the call was recorded").toBeDefined();
    const id = call!.id;
    const detail = (await consoleApi<{ call: CallDetail }>("GET", `/api/calls/get?id=${id}`)).text;
    const shown = (await consoleApi<{ call: CallDetail }>("POST", "/api/calls/reveal", { id }, { "x-console": "1" })).text;
    if (token) expect((detail + shown).includes(token), "a stored Call contains the session token").toBe(false);
    if (secret) expect(detail.includes(secret), "the secret is hidden until shown").toBe(false);
  });

  it("refuses a request from a browser and counts it", async () => {
    const before = (await consoleApi<GatewayStatus>("GET", "/api/gateway")).json.refusedFromBrowser.count;
    const res = await fetch(`http://127.0.0.1:${GATEWAY}/bucket/key`, { headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("refuses requests sent from a browser");
    const after = (await consoleApi<GatewayStatus>("GET", "/api/gateway")).json.refusedFromBrowser;
    expect(after.count).toBe(before + 1);
    expect(after.lastAt).not.toBeNull();
  });

  it("accepts TLS on the same port for a caller that trusts the certificate, and counts one that doesn't", async () => {
    const pem = (await consoleApi<unknown>("GET", "/api/gateway/certificate")).text;
    expect(pem).toContain("BEGIN CERTIFICATE");
    expect(pem).not.toContain("PRIVATE KEY");
    const get = (ca?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = https.request({ host: "127.0.0.1", port: GATEWAY, path: "/", servername: "localhost", ...(ca ? { ca } : {}) }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });
    await expect(get(pem)).resolves.toBeGreaterThan(0);
    const before = (await consoleApi<GatewayStatus>("GET", "/api/gateway")).json.tlsRefused.count;
    await expect(get()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 300));
    expect((await consoleApi<GatewayStatus>("GET", "/api/gateway")).json.tlsRefused.count).toBe(before + 1);
  });

  it("refuses to change or reveal anything for a request that doesn't come from the Console's own page", async () => {
    const noOrigin = await consoleApi<unknown>("POST", "/api/calls/clear", {}, { origin: "http://evil.example" });
    expect(noOrigin.status).toBe(403);
    const reveal = await consoleApi<unknown>("POST", "/api/calls/reveal", { id: 1 }, { origin: "http://evil.example" });
    expect(reveal.status).toBe(403);
  });
});
