import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { fingerprintKeys, readKeysFingerprint } from "./keys.js";

const FULL = "[default]\naws_access_key_id = AKIAONE\naws_secret_access_key = secretone\n";

describe("fingerprintKeys", () => {
  it("is the same for the same pair and differs for a new one", () => {
    expect(fingerprintKeys(FULL)).toBe(fingerprintKeys(FULL));
    expect(fingerprintKeys(FULL.replace("secretone", "secrettwo"))).not.toBe(fingerprintKeys(FULL));
    expect(fingerprintKeys(FULL.replace("AKIAONE", "AKIATWO"))).not.toBe(fingerprintKeys(FULL));
  });

  it("is null for an empty or half-written file", () => {
    expect(fingerprintKeys("")).toBeNull();
    expect(fingerprintKeys("[default]\n")).toBeNull();
    expect(fingerprintKeys("[default]\naws_access_key_id = AKIAONE\n")).toBeNull();
    expect(fingerprintKeys("[default]\naws_access_key_id = AKIAONE\naws_secret_access_key =")).toBeNull();
  });

  it("is null when the text is cut off, even mid-secret", () => {
    expect(fingerprintKeys(FULL.slice(0, -1))).toBeNull(); // no final newline
    expect(fingerprintKeys(FULL.slice(0, -5))).toBeNull();
  });

  it("does not contain the keys", () => {
    expect(fingerprintKeys(FULL)).not.toContain("secretone");
  });
});

describe("readKeysFingerprint", () => {
  let tmp: string;
  let config: Config;
  const run = () => path.join(tmp, "home", "9297");

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "console-keys-"));
    mkdirSync(run(), { recursive: true });
    config = { emulatorHome: path.join(tmp, "home"), emulatorPort: 9297 } as Config;
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("reads a regular file", async () => {
    writeFileSync(path.join(run(), "emulator_credentials"), FULL);
    expect(await readKeysFingerprint(config)).toBe(fingerprintKeys(FULL));
  });

  it("treats an empty file, a symlink and an oversized file as missing", async () => {
    const file = path.join(run(), "emulator_credentials");
    writeFileSync(file, "");
    expect(await readKeysFingerprint(config)).toBeNull();
    rmSync(file);
    writeFileSync(path.join(tmp, "elsewhere"), FULL);
    symlinkSync(path.join(tmp, "elsewhere"), file);
    expect(await readKeysFingerprint(config)).toBeNull();
    rmSync(file);
    writeFileSync(file, FULL + "#".repeat(8000));
    expect(await readKeysFingerprint(config)).toBeNull();
  });

  it("treats a FIFO in place of the file as missing, without blocking", async () => {
    const file = path.join(run(), "emulator_credentials");
    rmSync(file, { force: true });
    execFileSync("mkfifo", [file]);
    expect(await readKeysFingerprint(config)).toBeNull();
    rmSync(file);
  });

  it("treats a missing file as missing", async () => {
    expect(await readKeysFingerprint({ ...config, emulatorPort: 1 })).toBeNull();
  });
});
