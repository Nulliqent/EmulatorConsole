import path from "node:path";
import type { Config } from "../config.js";
import { readSmallFileResult } from "../safefile.js";

// Reads the Emulator's per-run files (`<port>/ca.pem`, `<port>/emulator_credentials`) for sending. New keys mean the
// Emulator restarted, so the files are read afresh for every send (they are tiny): there is no cache to go stale.
// The credentials stay on the server: nothing here is returned from an API route, logged, or put in an error message.
// The health monitor reads the same files with the same reader and the same size limits (see emulator.ts, keys.ts).

/** The most bytes read from ca.pem. */
export const MAX_CA_BYTES = 16 * 1024;
/** The most bytes read from emulator_credentials. */
export const MAX_KEYS_BYTES = 4096;

export const runFile = (config: Config, name: string): string => path.join(config.emulatorHome, String(config.emulatorPort), name);

export class RunFileError extends Error {
  constructor(readonly file: "ca.pem" | "emulator_credentials", readonly why: "missing" | "unsafe" | "invalid") {
    // Names the file and the reason, never its contents or path.
    super(`${file}: ${why}`);
    this.name = "RunFileError";
  }
}

export type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/** Parses the INI file the Emulator writes: `[default]`, `aws_access_key_id = ...`, `aws_secret_access_key = ...`. */
export function parseCredentials(text: string): Credentials | undefined {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  let section = "default";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1]!.trim();
      continue;
    }
    if (section !== "default") continue;
    const eq = line.indexOf("=");
    if (eq > 0) values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const accessKeyId = values.aws_access_key_id;
  const secretAccessKey = values.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey, ...(values.aws_session_token ? { sessionToken: values.aws_session_token } : {}) };
}

async function read<T>(file: string, max: number, name: RunFileError["file"], parse: (text: string) => T | undefined): Promise<T> {
  const result = await readSmallFileResult(file, max);
  if (!result.ok) throw new RunFileError(name, result.reason);
  const value = parse(result.text);
  if (value === undefined) throw new RunFileError(name, "invalid");
  return value;
}

/** The run's keys, as they are in the file now. */
export const readCredentials = (config: Config) => read(runFile(config, "emulator_credentials"), MAX_KEYS_BYTES, "emulator_credentials", parseCredentials);

/** The run's CA certificate, the only one the Console trusts for the Emulator. */
export const readCa = (config: Config) =>
  read(runFile(config, "ca.pem"), MAX_CA_BYTES, "ca.pem", (text) => (text.includes("BEGIN CERTIFICATE") ? text : undefined));
