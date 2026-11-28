import { createHash } from "node:crypto";
import path from "node:path";
import type { Config } from "./config.js";
import { readSmallFile } from "./safefile.js";

const MAX_KEYS_BYTES = 4096;

/** Where the run's keys are, as shown to the Developer. The file's contents never are. */
export function keysDisplayPath(config: Config): string {
  return `.aws/emulator/${config.emulatorPort}/emulator_credentials`;
}

/**
 * A fingerprint of the key pair in the file's text, or null if the pair isn't complete. Only the two parsed values
 * are hashed, so a half-written file (the Emulator removes, creates, then writes) is "no keys yet", not new keys.
 */
export function fingerprintKeys(text: string): string | null {
  const values = [...text.matchAll(/^[ \t]*[\w.-]+[ \t]*=[ \t]*(\S+)[ \t]*$/gm)].map((m) => m[1]!);
  // The file holds an access key id and a secret: two values at least. One is a file still being written.
  if (values.length < 2 || !text.endsWith("\n")) return null; // the Emulator writes the whole file ending in a newline
  const hash = createHash("sha256");
  for (const v of values) hash.update(v).update("\0");
  return hash.digest("hex");
}

/**
 * A fingerprint of this run's keys, or null if the file isn't there, isn't a small regular file, or isn't
 * complete. It is compared with the last one to notice a restart. It stays in the server: it is never sent
 * to the browser or logged.
 */
export async function readKeysFingerprint(config: Config): Promise<string | null> {
  const text = await readSmallFile(path.join(config.emulatorHome, String(config.emulatorPort), "emulator_credentials"), MAX_KEYS_BYTES);
  return text === null ? null : fingerprintKeys(text);
}
