import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readSmallFileResult } from "../safefile.js";
import { RunFileError, parseCredentials, readCredentials } from "./run-files.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "run-files-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readSmallFileResult (the one reader for run files)", () => {
  it("reads a regular file, longer than one read chunk, whole", async () => {
    writeFileSync(path.join(dir, "a"), "hello");
    expect(await readSmallFileResult(path.join(dir, "a"), 100)).toEqual({ ok: true, text: "hello" });
    writeFileSync(path.join(dir, "long"), "x".repeat(20000));
    expect(await readSmallFileResult(path.join(dir, "long"), 30000)).toMatchObject({ ok: true, text: "x".repeat(20000) });
  });
  it("says missing for a missing file", async () => {
    expect(await readSmallFileResult(path.join(dir, "nope"), 100)).toEqual({ ok: false, reason: "missing" });
  });
  it("refuses a symlink, a directory and a file over the size cap", async () => {
    writeFileSync(path.join(dir, "target"), "secret");
    symlinkSync(path.join(dir, "target"), path.join(dir, "link"));
    mkdirSync(path.join(dir, "d"));
    writeFileSync(path.join(dir, "big"), Buffer.alloc(100));
    expect(await readSmallFileResult(path.join(dir, "link"), 100)).toEqual({ ok: false, reason: "unsafe" });
    expect(await readSmallFileResult(path.join(dir, "d"), 100)).toEqual({ ok: false, reason: "unsafe" });
    expect(await readSmallFileResult(path.join(dir, "big"), 50)).toEqual({ ok: false, reason: "unsafe" });
  });
});

describe("parseCredentials", () => {
  it("reads the default profile", () => {
    expect(parseCredentials("[default]\naws_access_key_id = AK\naws_secret_access_key = SK\n")).toEqual({ accessKeyId: "AK", secretAccessKey: "SK" });
  });
  it("ignores other profiles and refuses an incomplete file", () => {
    expect(parseCredentials("[other]\naws_access_key_id = AK\naws_secret_access_key = SK\n")).toBeUndefined();
    expect(parseCredentials("[default]\naws_access_key_id = AK\n")).toBeUndefined();
    expect(parseCredentials("")).toBeUndefined();
  });
});

describe("readCredentials", () => {
  const config = () => ({ emulatorHome: dir, emulatorPort: 4000 }) as never;
  it("reads the file as it is now, every time (new keys are seen at once, even when the size and time match)", async () => {
    mkdirSync(path.join(dir, "4000"), { recursive: true });
    const file = path.join(dir, "4000", "emulator_credentials");
    writeFileSync(file, "[default]\naws_access_key_id = AAAAAAAA\naws_secret_access_key = SSSSSSSS\n");
    expect((await readCredentials(config())).accessKeyId).toBe("AAAAAAAA");
    writeFileSync(file, "[default]\naws_access_key_id = BBBBBBBB\naws_secret_access_key = TTTTTTTT\n");
    expect(await readCredentials(config())).toMatchObject({ accessKeyId: "BBBBBBBB", secretAccessKey: "TTTTTTTT" });
  });
  it("throws a RunFileError that names the file and not its content", async () => {
    const err = await readCredentials({ emulatorHome: dir, emulatorPort: 4001 } as never).catch((e) => e);
    expect(err).toBeInstanceOf(RunFileError);
    expect(String(err.message)).toBe("emulator_credentials: missing");
  });
});
