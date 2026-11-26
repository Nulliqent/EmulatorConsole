import { describe, expect, it } from "vitest";
import { childrenOf, isSensitiveMember, isSensitiveShape, reachableShapes, sensitivePaths } from "./sensitive.js";
import type { Shapes } from "./sensitive.js";

const S = { "smithy.api#sensitive": {} };
const str = { target: "smithy.api#String" };

const shapes: Shapes = {
  // The EMR containers pattern: Configuration -> configurations[] -> Configuration, with a map of properties.
  "t#Configuration": {
    type: "structure",
    members: {
      classification: str,
      configurations: { target: "t#ConfigurationList" },
      properties: { target: "t#SensitivePropertyMap" },
    },
  },
  "t#ConfigurationList": { type: "list", member: { target: "t#Configuration" } },
  "t#SensitivePropertyMap": { type: "map", key: str, value: { target: "t#Secret" } },
  "t#Secret": { type: "string", traits: S },
  "t#KeyedMap": { type: "map", key: { target: "smithy.api#String", traits: S }, value: str },
  "t#Union": { type: "union", members: { a: str, b: { target: "smithy.api#String", traits: S } } },
  "t#Err": { type: "structure", traits: { "smithy.api#error": "client" }, members: { Token: { target: "t#Secret" }, message: str } },
  "t#WholeSecret": { type: "structure", traits: S, members: { x: str } },
  "t#Outer": { type: "structure", members: { Keyed: { target: "t#KeyedMap" }, U: { target: "t#Union" }, Cfg: { target: "t#Configuration" } } },
  "t#Op": { type: "operation", input: { target: "t#Outer" }, output: { target: "smithy.api#Unit" }, errors: [{ target: "t#Err" }] },
};

describe("isSensitiveMember / isSensitiveShape", () => {
  it("is true for the trait on the member or on its target shape, and false otherwise", () => {
    expect(isSensitiveMember(shapes, { target: "smithy.api#String", traits: S })).toBe(true);
    expect(isSensitiveMember(shapes, { target: "t#Secret" })).toBe(true);
    expect(isSensitiveMember(shapes, str)).toBe(false);
    expect(isSensitiveShape(shapes, "t#WholeSecret")).toBe(true);
    expect(isSensitiveShape(shapes, "t#Nope")).toBe(false);
  });

  it("cannot be fooled by names on Object.prototype", () => {
    expect(isSensitiveShape(shapes, "__proto__")).toBe(false);
    expect(isSensitiveShape(shapes, "constructor")).toBe(false);
    expect(childrenOf(shapes, "toString")).toEqual([]);
  });
});

describe("childrenOf", () => {
  it("steps through structure and union members, list elements and map keys and values", () => {
    expect(childrenOf(shapes, "t#Union")).toEqual([
      { step: "a", target: "smithy.api#String", sensitive: false },
      { step: "b", target: "smithy.api#String", sensitive: true },
    ]);
    expect(childrenOf(shapes, "t#ConfigurationList")).toEqual([{ step: "[]", target: "t#Configuration", sensitive: false }]);
    expect(childrenOf(shapes, "t#KeyedMap")).toEqual([
      { step: "{key}", target: "smithy.api#String", sensitive: true },
      { step: "{}", target: "smithy.api#String", sensitive: false },
    ]);
    expect(childrenOf(shapes, "t#SensitivePropertyMap").map((c) => [c.step, c.sensitive])).toEqual([["{key}", false], ["{}", true]]);
    expect(childrenOf(shapes, "t#Err").map((c) => [c.step, c.sensitive])).toEqual([["Token", true], ["message", false]]);
    expect(childrenOf(shapes, "smithy.api#String")).toEqual([]);
  });
});

describe("sensitivePaths", () => {
  it("finds secrets in maps (keys and values), unions and lists, and ends a branch at a reference back to an ancestor", () => {
    expect(sensitivePaths(shapes, "t#Outer")).toEqual([
      "Cfg.properties{}",
      "Keyed{key}",
      "U.b",
    ]);
  });

  it("reports a sensitive root as $, and nothing for no shape", () => {
    expect(sensitivePaths(shapes, "t#WholeSecret")).toEqual(["$"]);
    expect(sensitivePaths(shapes, undefined)).toEqual([]);
    expect(sensitivePaths(shapes, "smithy.api#Unit")).toEqual([]);
  });

  it("gives the same answer whatever order shapes are visited in, sharing one memo", () => {
    // A -> B -> A, and A holds a secret. Asking for A first must not hide A's secret from B.
    const cyc: Shapes = {
      "c#A": { type: "structure", members: { Secret: { target: "smithy.api#String", traits: S }, B: { target: "c#B" } } },
      "c#B": { type: "structure", members: { A: { target: "c#A" }, Other: str } },
    };
    const fresh = sensitivePaths(cyc, "c#B");
    expect(fresh).toEqual(["A.Secret"]);
    const memo = new Map<string, string[]>();
    expect(sensitivePaths(cyc, "c#A", memo)).toEqual(["Secret"]);
    expect(sensitivePaths(cyc, "c#B", memo)).toEqual(fresh);
  });
});

describe("reachableShapes", () => {
  it("follows members, elements, keys, values, and an operation's input, output and errors", () => {
    const got = reachableShapes(shapes, ["t#Op"]);
    expect(Object.keys(got).sort()).toEqual([
      "t#Configuration", "t#ConfigurationList", "t#Err", "t#KeyedMap", "t#Op", "t#Outer", "t#Secret", "t#SensitivePropertyMap", "t#Union",
    ]);
    expect(got["t#Err"].traits).toEqual({ "smithy.api#error": "client" });
  });

  it("ignores ids that are not shapes", () => {
    expect(Object.keys(reachableShapes(shapes, ["__proto__", "constructor", "t#Nope"]))).toEqual([]);
  });
});
