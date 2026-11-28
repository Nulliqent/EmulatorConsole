// The run's keys must never leave the server. The Emulator should never echo them; these functions are the backstop
// that replaces any occurrence in text, bytes or a result before it is returned.

export const REDACTED = "[redacted]";

/** The values worth hunting for: very short ones would redact ordinary text. */
export function secretsOf(credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }): string[] {
  return [credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken].filter((s): s is string => !!s && s.length >= 8);
}

export function scrubString(s: string, secrets: readonly string[]): string {
  let out = s;
  for (const secret of secrets) if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  return out;
}

/** The bytes with any occurrence of a secret (as UTF-8 or Latin-1 text) replaced; the same buffer when there is none. */
export function scrubBytes(bytes: Uint8Array, secrets: readonly string[]): Uint8Array {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!secrets.some((s) => buffer.includes(s))) return bytes;
  return Buffer.from(scrubString(buffer.toString("latin1"), secrets.map((s) => Buffer.from(s).toString("latin1"))), "latin1");
}

/** Replaces the run's keys in every string (and key) of a JSON-like value. */
export function scrub(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return scrubString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets));
  if (value && typeof value === "object") {
    const out = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(value)) out[scrubString(k, secrets)] = scrub(v, secrets);
    return out;
  }
  return value;
}
