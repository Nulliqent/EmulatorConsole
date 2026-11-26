import { describe, expect, it } from "vitest";
import { byCodePoint, classifyService, describeOperation, listKind, primaryProtocol, readService } from "./analyze.js";
import type { SmithyShape } from "../types.js";

const S = { "smithy.api#sensitive": {} };
const str = { target: "smithy.api#String" };
const REQ = { "smithy.api#required": {} };
const op = (input: string, output: string): SmithyShape => ({ type: "operation", input: { target: input }, output: { target: output } });

const ast = {
  shapes: {
    // Two operations whose inputs are A and B, where A -> B -> A and A holds a secret.
    "t#A": { type: "structure", members: { Secret: { target: "smithy.api#String", traits: S }, B: { target: "t#B" } } },
    "t#B": { type: "structure", members: { A: { target: "t#A" } } },
    "t#Op1": op("t#A", "smithy.api#Unit"),
    "t#Op2": op("t#B", "smithy.api#Unit"),

    "t#NoInput": { type: "structure", members: {} },
    "t#NeedsId": { type: "structure", members: { Id: { target: "smithy.api#String", traits: REQ } } },
    "t#Items": { type: "structure", members: { Items: { target: "t#ItemList" } } },
    "t#ItemList": { type: "list", member: str },
    "t#ItemMap": { type: "structure", members: { ByName: { target: "t#Map" } } },
    "t#Map": { type: "map", key: str, value: str },
    "t#Scalar": { type: "structure", members: { Count: { target: "smithy.api#Integer" } } },

    "t#ListThings": op("smithy.api#Unit", "t#Items"),
    "t#DescribeThings": op("t#NoInput", "t#ItemMap"),
    "t#ListNeedy": op("t#NeedsId", "t#Items"),
    "t#DescribeNeedy": op("t#NeedsId", "t#Items"),
    "t#GetThings": op("smithy.api#Unit", "t#Items"),
    "t#SearchThings": op("t#NoInput", "t#Items"),
    "t#GetCount": op("smithy.api#Unit", "t#Scalar"),
    "t#ListNothing": op("smithy.api#Unit", "smithy.api#Unit"),
    "t#PutThing": op("smithy.api#Unit", "t#Items"),
  } as Record<string, SmithyShape>,
};

describe("sensitive paths across operations", () => {
  it("reports the secret of A for an operation whose input is B, whatever order operations are described in", () => {
    for (const order of [["t#Op1", "t#Op2"], ["t#Op2", "t#Op1"]]) {
      const memo = new Map<string, string[]>();
      const got = Object.fromEntries(order.map((id) => [id, describeOperation(ast, id, memo).sensitive.input]));
      expect(got).toEqual({ "t#Op1": ["Secret"], "t#Op2": ["A.Secret"] });
    }
  });
});

describe("list classification", () => {
  const kind = (name: string) => listKind(ast, `t#${name}`);

  it("accepts List and Describe (tier one) and Get and Search (tier two) that return a collection with no required input", () => {
    expect(kind("ListThings")).toBe("list");
    expect(kind("DescribeThings")).toBe("list"); // a map-only output counts as a collection
    expect(kind("GetThings")).toBe("get-or-search");
    expect(kind("SearchThings")).toBe("get-or-search");
  });

  it("rejects a required input member, a scalar output, no output, and other verbs", () => {
    expect(kind("ListNeedy")).toBeUndefined();
    expect(kind("DescribeNeedy")).toBeUndefined();
    expect(kind("GetCount")).toBeUndefined();
    expect(kind("ListNothing")).toBeUndefined();
    expect(kind("PutThing")).toBeUndefined();
  });

  it("classifies a service by its best operation", () => {
    expect(classifyService(["get-or-search", "list", undefined])).toBe("list");
    expect(classifyService([undefined, "get-or-search"])).toBe("get-or-search");
    expect(classifyService([undefined, undefined])).toBe("none");
    expect(classifyService([])).toBe("none");
  });
});

describe("protocol choice", () => {
  it("prefers the first declared JSON, query or XML protocol and skips rpcv2Cbor", () => {
    expect(primaryProtocol(["awsJson1_1", "rpcv2Cbor"])).toBe("awsJson1_1");
    expect(primaryProtocol(["awsJson1_0", "awsQuery", "awsQueryCompatible", "rpcv2Cbor"])).toBe("awsJson1_0");
    expect(primaryProtocol(["awsJson1_0", "awsQueryCompatible"])).toBe("awsJson1_0");
    expect(primaryProtocol(["restXml"])).toBe("restXml");
  });

  it("uses rpcv2Cbor only when it is the only protocol", () => {
    expect(primaryProtocol(["rpcv2Cbor"])).toBe("rpcv2Cbor");
  });

  it("refuses a model that declares no usable protocol", () => {
    expect(() => primaryProtocol([])).toThrow(/no supported protocol/);
    expect(() => primaryProtocol(["awsQueryCompatible"])).toThrow(/no supported protocol/);
  });

  it("reads the awsQueryCompatible variant and the missing-protocol error from a model", () => {
    const service = (traits: Record<string, unknown>) => ({
      shapes: { "x#S": { type: "service", traits: { "aws.api#service": { sdkId: "X" }, ...traits } } } as Record<string, SmithyShape>,
    });
    const compat = readService(service({ "aws.protocols#awsJson1_0": {}, "aws.protocols#awsQueryCompatible": {} }), "x.json");
    expect(compat).toMatchObject({ protocol: "awsJson1_0", awsQueryCompatible: true });
    expect(() => readService(service({}), "x.json")).toThrow(/no supported protocol/);
  });
});

describe("ordering", () => {
  it("is code-point order, not locale order", () => {
    expect(["b", "B", "a", "_", "é", "Z"].sort(byCodePoint)).toEqual(["B", "Z", "_", "a", "b", "é"]);
  });
});
