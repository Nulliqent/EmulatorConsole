import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { ModelIndex } from "../model-index/index.js";
import type { ServiceModelFile } from "../model-index/index.js";
import { cutBody, declaredErrorNames, isDeclaredError, isEmulatorGap, RAW_BODY_LIMIT, wireErrorCode } from "./classify.js";

const modelled = { modelled: true };

describe("isEmulatorGap", () => {
  it("is true for 501, UnknownService (404) and InvalidAction of a modelled operation", () => {
    expect(isEmulatorGap(501, [], modelled)).toBe(true);
    expect(isEmulatorGap(501, ["SomethingElse"], modelled)).toBe(true);
    expect(isEmulatorGap(400, ["NotImplemented"], modelled)).toBe(true);
    expect(isEmulatorGap(404, ["UnknownService"], modelled)).toBe(true);
    expect(isEmulatorGap(400, ["InvalidAction"], modelled)).toBe(true);
  });
  it("reads UnknownService from the wire code when the SDK's name for the error is generic", () => {
    expect(isEmulatorGap(404, ["UnknownError", "com.amazonaws#UnknownService"], modelled)).toBe(true);
  });
  it("counts InvalidAction only for a modelled operation", () => {
    expect(isEmulatorGap(400, ["InvalidAction"], { modelled: false })).toBe(false);
    expect(isEmulatorGap(501, [], { modelled: false })).toBe(true);
  });
  it("is false for ordinary answers and errors", () => {
    expect(isEmulatorGap(200, [undefined], modelled)).toBe(false);
    expect(isEmulatorGap(404, ["NoSuchBucket"], modelled)).toBe(false);
    expect(isEmulatorGap(400, ["UnknownService"], modelled)).toBe(false);
    expect(isEmulatorGap(500, ["AmbiguousService"], modelled)).toBe(false);
    expect(isEmulatorGap(400, ["ValidationError"], modelled)).toBe(false);
  });
});

describe("wireErrorCode", () => {
  it("reads the header, a JSON code or an XML code", () => {
    expect(wireErrorCode({ "x-amzn-errortype": "UnknownService:http://x" }, "")).toBe("UnknownService");
    expect(wireErrorCode({}, '{"__type":"com.amazonaws.dynamodb.v20120810#ResourceInUseException","message":"m"}')).toBe("ResourceInUseException");
    expect(wireErrorCode({}, '{"code":"NoSuchThing"}')).toBe("NoSuchThing");
    expect(wireErrorCode({}, "<Error><Code>NoSuchBucket</Code></Error>")).toBe("NoSuchBucket");
    expect(wireErrorCode({}, "<html>")).toBeUndefined();
  });
});

describe("declared errors", () => {
  let sqs: ServiceModelFile;
  beforeAll(async () => {
    const index = await ModelIndex.load(path.resolve(import.meta.dirname, "..", "..", "..", "data", "model-index"));
    sqs = (await index.detail("SQS"))!;
  });

  it("includes the shape name and the awsQueryError wire code", () => {
    const names = declaredErrorNames(sqs, "GetQueueUrl");
    expect(names.has("QueueDoesNotExist")).toBe(true);
    expect(names.has("AWS.SimpleQueueService.NonExistentQueue")).toBe(true);
    expect(names.has("QueueNameExists")).toBe(false);
  });
  it("matches a wire code, a shape name and a namespaced name; not an error the operation does not declare", () => {
    const names = declaredErrorNames(sqs, "GetQueueUrl");
    expect(isDeclaredError(names, "AWS.SimpleQueueService.NonExistentQueue")).toBe(true);
    expect(isDeclaredError(names, "x", "com.amazonaws.sqs#QueueDoesNotExist")).toBe(true);
    expect(isDeclaredError(names, "QueueDoesNotExist:http://internal.amazon.com/coral/")).toBe(true);
    expect(isDeclaredError(names, "QueueNameExists")).toBe(false);
    expect(isDeclaredError(names, undefined)).toBe(false);
  });
  it("is empty for an unknown operation", () => {
    expect(declaredErrorNames(sqs, "Nope").size).toBe(0);
  });
});

describe("cutBody", () => {
  it("returns a small text body whole", () => {
    expect(cutBody(Buffer.from("héllo"))).toEqual({ body: "héllo", encoding: "utf8", size: 6, sizeIsMinimum: false, truncated: false });
  });
  it("cuts at 256 KB, reporting the original size", () => {
    const cut = cutBody(Buffer.alloc(RAW_BODY_LIMIT + 10, "a"));
    expect(cut.truncated).toBe(true);
    expect(cut.size).toBe(RAW_BODY_LIMIT + 10);
    expect(cut.body).toHaveLength(RAW_BODY_LIMIT);
  });
  it("does not call a body binary because the cut split a character", () => {
    const text = Buffer.from("é".repeat(RAW_BODY_LIMIT)); // 2 bytes each; the limit falls between characters or inside one
    const cut = cutBody(Buffer.concat([Buffer.from("a"), text]));
    expect(cut.encoding).toBe("utf8");
    expect(cut.truncated).toBe(true);
  });
  it("uses base64 for bytes that are not text, and says when the size is only a minimum", () => {
    expect(cutBody(Buffer.from([0xff, 0xfe]))).toMatchObject({ encoding: "base64", body: "//4=" });
    expect(cutBody(Buffer.from("abc"), 10_000_000, undefined, true)).toMatchObject({ size: 10_000_000, truncated: true, sizeIsMinimum: true });
  });
});
