import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertOutsideSources, buildModelIndex } from "./build.js";
import { ModelIndex } from "../index.js";

// A miniature of the two reference clones, built in a temp folder.

const SDK = "Widgets";
const ns = "example.widgets#";
const model = {
  smithy: "2.0",
  shapes: {
    [`${ns}Widgets`]: {
      type: "service",
      version: "1",
      operations: [`${ns}ListWidgets`, `${ns}GetWidget`, `${ns}PutSecret`, `${ns}DeleteWidget`, `${ns}ListThings`].map((target) => ({ target })),
      resources: [{ target: `${ns}Gadget` }],
      errors: [{ target: `${ns}Throttled` }],
      traits: {
        "aws.api#service": { sdkId: SDK, arnNamespace: "widgets", endpointPrefix: "widgets" },
        "aws.auth#sigv4": { name: "widgets" },
        "aws.protocols#awsJson1_1": {},
        "smithy.protocols#rpcv2Cbor": {},
        "smithy.api#title": "Amazon Widgets",
        "smithy.api#documentation": "Prose that must not be kept.",
        "smithy.rules#endpointRuleSet": { rules: [] },
      },
    },
    [`${ns}Gadget`]: { type: "resource", read: { target: `${ns}GetGadget` } },
    [`${ns}GetGadget`]: {
      type: "operation",
      input: { target: `${ns}Id` },
      output: { target: "smithy.api#Unit" },
      traits: { "smithy.api#readonly": {} },
    },
    [`${ns}Id`]: { type: "structure", members: { Id: { target: "smithy.api#String", traits: { "smithy.api#required": {} } } } },
    [`${ns}ListWidgets`]: {
      type: "operation",
      input: { target: "smithy.api#Unit" },
      output: { target: `${ns}ListWidgetsOutput` },
      errors: [{ target: `${ns}NotFound` }],
      traits: { "smithy.api#readonly": {}, "smithy.api#paginated": {}, "smithy.api#http": { method: "GET", uri: "/w", code: 200 } },
    },
    [`${ns}ListWidgetsOutput`]: {
      type: "structure",
      members: { Widgets: { target: `${ns}WidgetList` }, NextToken: { target: "smithy.api#String" } },
    },
    [`${ns}WidgetList`]: { type: "list", member: { target: "smithy.api#String" } },
    [`${ns}GetWidget`]: {
      type: "operation",
      input: { target: `${ns}GetWidgetInput` },
      output: { target: `${ns}GetWidgetOutput` },
    },
    [`${ns}GetWidgetInput`]: { type: "structure", members: { Name: { target: "smithy.api#String", traits: { "smithy.api#required": {} } } } },
    [`${ns}GetWidgetOutput`]: { type: "structure", members: { Tags: { target: `${ns}TagMap` } } },
    [`${ns}TagMap`]: { type: "map", key: { target: "smithy.api#String" }, value: { target: "smithy.api#String" } },
    [`${ns}PutSecret`]: { type: "operation", input: { target: `${ns}PutSecretInput` }, output: { target: `${ns}PutSecretOutput` } },
    [`${ns}PutSecretInput`]: {
      type: "structure",
      members: {
        Password: { target: "smithy.api#String", traits: { "smithy.api#sensitive": {} } },
        Config: { target: `${ns}Config` },
        Tokens: { target: `${ns}TokenList` },
        Plain: { target: "smithy.api#String", traits: { "smithy.api#documentation": "x" } },
      },
    },
    [`${ns}Config`]: {
      type: "structure",
      members: { Key: { target: `${ns}Secret` }, Self: { target: `${ns}Config` } },
    },
    [`${ns}Secret`]: { type: "string", traits: { "smithy.api#sensitive": {} } },
    [`${ns}TokenList`]: { type: "list", member: { target: `${ns}Secret` } },
    [`${ns}PutSecretOutput`]: { type: "structure", members: { Echo: { target: "smithy.api#String", traits: { "smithy.api#sensitive": {} } } } },
    [`${ns}DeleteWidget`]: { type: "operation", input: { target: `${ns}GetWidgetInput` }, output: { target: "smithy.api#Unit" } },
    [`${ns}ListThings`]: { type: "operation", input: { target: "smithy.api#Unit" }, output: { target: "smithy.api#Unit" } },
    [`${ns}Throttled`]: { type: "structure", traits: { "smithy.api#error": "client" } },
    [`${ns}NotFound`]: { type: "structure", traits: { "smithy.api#error": "client" } },
  },
};
const otherModel = {
  smithy: "2.0",
  shapes: {
    "example.other#Other": {
      type: "service",
      traits: { "aws.api#service": { sdkId: "Other" }, "aws.protocols#restXml": {}, "smithy.api#title": "Other" },
    },
  },
};

let root: string;
let apiModels: string;
let emulator: string;
let out: string;

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const opFile = (name: string, scaffolded: boolean) =>
  `// SPDX\n\n//! @op ${name}\n${scaffolded ? "//! SCAFFOLDED, NOT IMPLEMENTED: this operation answers HTTP 501\n" : "//! IMPLEMENTED: yes\n"}//!\n`;

/** Every file under a folder with its content hash and modification time. */
function snapshot(dir: string): string {
  const entries: string[] = [];
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else entries.push(`${path.relative(dir, p)} ${st.mtimeMs} ${createHash("sha256").update(fs.readFileSync(p)).digest("hex")}`);
    }
  };
  walk(dir);
  return entries.join("\n");
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "model-index-"));
  apiModels = path.join(root, "api-models-aws");
  emulator = path.join(root, "aws-emulator");
  out = path.join(root, "out");

  write(path.join(apiModels, "models/widgets/service/2024-01-01/widgets-2024-01-01.json"), JSON.stringify(model));
  write(path.join(apiModels, "models/other/service/2024-01-01/other-2024-01-01.json"), JSON.stringify(otherModel));
  write(path.join(apiModels, ".git/HEAD"), "ref: refs/heads/main\n");
  write(path.join(apiModels, ".git/refs/heads/main"), "a".repeat(40) + "\n");

  const crate = path.join(emulator, "services/service-example-widgets");
  write(path.join(crate, "OPERATIONS.md"), "# Operations\n\n- **Protocol:** `awsJson1_1`\n- **SDK id:** `Widgets`\n");
  write(path.join(crate, "src/ops/mod.rs"), "include!();\n");
  write(path.join(crate, "src/ops/list_widgets.rs"), opFile("ListWidgets", false));
  write(path.join(crate, "src/ops/get_widget.rs"), opFile("GetWidget", true));
  write(path.join(crate, "src/ops/get_gadget.rs"), opFile("GetGadget", false));
  write(path.join(crate, "src/ops/extra_thing.rs"), opFile("ExtraThing", true));
  write(path.join(crate, "src/ops/SKIPPED_STUBS.md"), "# Skipped\n\n// SKIPPED: DeleteWidget — unsupported shape construct\n");
  write(path.join(emulator, ".emulator/scaffolded-specs.json"), JSON.stringify({
    scaffolded_services: [
      { shape_id: `${ns}Widgets`, spec_url: "https://raw.githubusercontent.com/aws/api-models-aws/refs/heads/main/models/widgets/service/2024-01-01/widgets-2024-01-01.json" },
    ],
  }));
  write(path.join(emulator, ".git/HEAD"), "ref: refs/heads/main\n");
  write(path.join(emulator, ".git/refs/heads/main"), "b".repeat(40) + "\n");
  write(path.join(emulator, ".git/packed-refs"), `${"c".repeat(40)} refs/tags/v1.0.1\n^${"b".repeat(40)}\n${"d".repeat(40)} refs/tags/v1.0.0\n^${"e".repeat(40)}\n`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("buildModelIndex", () => {
  it("never writes into either reference clone", () => {
    const before = [snapshot(apiModels), snapshot(emulator)];
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    expect([snapshot(apiModels), snapshot(emulator)]).toEqual(before);
    expect(fs.existsSync(path.join(out, "index.json"))).toBe(true);
  });

  it("refuses an output folder inside, or around, a clone, and writes nothing there", () => {
    const before = snapshot(emulator);
    for (const bad of [path.join(emulator, "data"), path.join(apiModels, "models"), root]) {
      expect(() => buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: bad })).toThrow(/read-only/);
    }
    expect(snapshot(emulator)).toBe(before);
    expect(() => assertOutsideSources(path.join(root, "elsewhere"), [apiModels, emulator])).not.toThrow();
  });

  it("refuses an output folder that reaches a clone through a symlink", () => {
    const link = path.join(root, "link-to-emulator");
    fs.symlinkSync(emulator, link);
    expect(() => assertOutsideSources(path.join(link, "data"), [emulator])).toThrow(/read-only/);
  });

  it("records the Emulator release from the tag at the checked-out commit", () => {
    const { meta } = buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    expect(meta.emulator).toEqual({ version: "1.0.1", commit: "b".repeat(40) });
    expect(meta.models.commit).toBe("a".repeat(40));
  });

  it("keeps only the services the Emulator offers and names the ones it lacks", () => {
    const { meta } = buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    expect(meta.models).toMatchObject({ total: 2, offered: 1, notOffered: [{ sdkId: "Other", title: "Other" }] });
    expect(meta.counts.services).toBe(1);
  });

  it("labels each operation for the Emulator release", async () => {
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    const index = await ModelIndex.load(out);
    const detail = (await index.detail(SDK))!;
    const labels = Object.fromEntries(detail.operations.map((o) => [o.name, o.implementation]));
    expect(labels).toEqual({
      ListWidgets: "implemented",
      GetWidget: "not-implemented", // scaffolded stub
      DeleteWidget: "not-implemented", // modelled but unwired: also 501
      GetGadget: "implemented", // reached through a resource
      PutSecret: "not-in-emulator",
      ListThings: "not-in-emulator",
    });
    expect(detail.emulatorOnly).toEqual([{ name: "ExtraThing", implementation: "not-implemented" }]);
    expect(index.service(SDK)).toMatchObject({ operationCount: 6, implemented: 2, notImplemented: 2, notInEmulator: 2, emulatorOnly: 1 });
  });

  it("classifies lists, protocols and sensitive members", async () => {
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    const index = await ModelIndex.load(out);
    const s = index.service(SDK)!;
    expect(s).toMatchObject({ protocol: "awsJson1_1", protocols: ["awsJson1_1", "rpcv2Cbor"], awsQueryCompatible: false, title: "Amazon Widgets", signingName: "widgets" });
    // GetWidget needs a Name, ListThings returns nothing: only ListWidgets lists without input.
    expect(s.listClass).toBe("list");
    expect(s.listOperations).toEqual(["ListWidgets"]);
    const put = (await index.operation(SDK, "PutSecret"))!;
    expect(put.sensitive).toEqual({ input: ["Config.Key", "Password", "Tokens[]"], output: ["Echo"] });
    expect(put.input).toBe(`${ns}PutSecretInput`);
    const list = (await index.operation(SDK, "ListWidgets"))!;
    expect(list).toMatchObject({ readonly: true, paginated: true, errors: [`${ns}NotFound`], http: { method: "GET", uri: "/w" }, list: "list" });
    expect(list.input).toBeUndefined();
    expect((await index.detail(SDK))!.commonErrors).toEqual([`${ns}Throttled`]);
  });

  it("keeps the shape graph and drops prose, examples and endpoint rules", async () => {
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    const detail = (await (await ModelIndex.load(out)).detail(SDK))!;
    expect(detail.shapes[`${ns}PutSecretInput`].members!.Plain).toEqual({ target: "smithy.api#String" });
    expect(detail.shapes[`${ns}GetWidgetInput`].members!.Name.traits).toEqual({ "smithy.api#required": {} });
    const service = detail.shapes[`${ns}Widgets`];
    expect(Object.keys(service.traits!).sort()).toEqual(
      ["aws.api#service", "aws.auth#sigv4", "aws.protocols#awsJson1_1", "smithy.api#title", "smithy.protocols#rpcv2Cbor"],
    );
  });

  it("stores each service compressed on its own", () => {
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: out });
    const packed = fs.readFileSync(path.join(out, "services", "widgets.json.br"));
    expect(JSON.parse(zlib.brotliDecompressSync(packed).toString()).sdkId).toBe(SDK);
  });
});

describe("buildModelIndex: guards and clone variants", () => {
  const copyEmulator = (name: string) => {
    const dest = path.join(root, name);
    fs.cpSync(emulator, dest, { recursive: true });
    return dest;
  };
  const build = (emulatorDir: string, extra: { emulatorVersion?: string } = {}) =>
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir, outDir: path.join(root, "out-variant"), ...extra });

  it("refuses an output folder that names a clone in other letters on a case-insensitive disk", () => {
    const insensitive = fs.existsSync(path.join(root, "API-MODELS-AWS"));
    const attempt = () => buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir: path.join(root, "API-MODELS-AWS", "x") });
    if (insensitive) expect(attempt).toThrow(/read-only/);
    else expect(attempt).not.toThrow(); // on a case-sensitive disk it is a different folder
  });

  it("does not write through a symlink at an output file", () => {
    const outDir = path.join(root, "out-symlink");
    const victim = path.join(root, "victim.txt");
    fs.writeFileSync(victim, "untouched");
    fs.mkdirSync(path.join(outDir, "services"), { recursive: true });
    fs.symlinkSync(victim, path.join(outDir, "index.json"));
    fs.symlinkSync(victim, path.join(outDir, "services", "widgets.json.br"));
    buildModelIndex({ apiModelsDir: apiModels, emulatorDir: emulator, outDir });
    expect(fs.readFileSync(victim, "utf8")).toBe("untouched");
    expect(fs.lstatSync(path.join(outDir, "index.json")).isSymbolicLink()).toBe(false);
  });

  it("reads the release from a loose lightweight tag", () => {
    const dir = copyEmulator("emu-loose");
    fs.rmSync(path.join(dir, ".git/packed-refs"));
    write(path.join(dir, ".git/refs/tags/v2.3.4"), "b".repeat(40) + "\n");
    expect(build(dir).meta.emulator.version).toBe("2.3.4");
  });

  it("follows a .git file to the real git folder (worktree or submodule)", () => {
    const dir = copyEmulator("emu-gitfile");
    fs.renameSync(path.join(dir, ".git"), path.join(root, "gitstore"));
    fs.writeFileSync(path.join(dir, ".git"), "gitdir: ../gitstore\n");
    expect(build(dir).meta.emulator.version).toBe("1.0.1");
  });

  it("says what is wrong when the release cannot be told, and accepts an explicit one", () => {
    const dir = copyEmulator("emu-untagged");
    fs.rmSync(path.join(dir, ".git/packed-refs"));
    expect(() => build(dir)).toThrow(/pass the version explicitly/);
    expect(build(dir, { emulatorVersion: "9.9.9" }).meta.emulator.version).toBe("9.9.9");
    fs.rmSync(path.join(dir, ".git"), { recursive: true });
    expect(() => build(dir)).toThrow(/not a git clone/);
  });

  it("refuses a HEAD that points outside .git", () => {
    const dir = copyEmulator("emu-escape");
    fs.writeFileSync(path.join(dir, ".git/HEAD"), "ref: ../../../etc/hostname\n");
    expect(() => build(dir)).toThrow(/outside \.git/);
    fs.writeFileSync(path.join(dir, ".git/HEAD"), "not a commit\n");
    expect(() => build(dir)).toThrow(/does not resolve to a commit/);
  });

  it("stops when the protocol the index chose is not the one the Emulator states", () => {
    const dir = copyEmulator("emu-protocol");
    const doc = path.join(dir, "services/service-example-widgets/OPERATIONS.md");
    fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace("`awsJson1_1`", "`restJson1`"));
    expect(() => build(dir)).toThrow(/chose protocol awsJson1_1 but the Emulator .* states restJson1/);
  });
});
