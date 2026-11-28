import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { closeSync, constants, fchmodSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { readSmallFileSync } from "../safefile.js";

// The Gateway's own TLS certificate. Returned URLs (SQS queue URLs, for one) always say https, so an SDK that follows one
// reaches the Gateway over TLS; the Gateway must present a certificate for the name in that URL. Node can't make
// certificates, and the Console installs no packages, so this writes the few ASN.1 structures a self-signed leaf needs.
//
// The certificate is a leaf (CA:FALSE), not a CA: a Developer who trusts it trusts this one key for localhost, 127.0.0.1
// and ::1, and nothing else. It is kept in GATEWAY_CERT_DIR (a compose volume) so it stays the same across restarts and
// is trusted once; without that folder it lives in memory and changes at every start.

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const oid = (bytes: number[]) => der(0x06, Buffer.from(bytes));
const utf8 = (s: string) => der(0x0c, Buffer.from(s, "utf8"));
const octets = (b: Buffer) => der(0x04, b);
const bool = (v: boolean) => der(0x01, Buffer.from([v ? 0xff : 0]));
/** UTCTime up to 2049, GeneralizedTime from 2050 (RFC 5280). */
const time = (d: Date) => {
  const iso = d.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:T]/g, "");
  return d.getUTCFullYear() >= 2050 ? der(0x18, Buffer.from(iso, "ascii")) : der(0x17, Buffer.from(iso.slice(2), "ascii"));
};

const OID_CN = [0x55, 0x04, 0x03];
const OID_ECDSA_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
const OID_BASIC_CONSTRAINTS = [0x55, 0x1d, 0x13];
const OID_KEY_USAGE = [0x55, 0x1d, 0x0f];
const OID_EXT_KEY_USAGE = [0x55, 0x1d, 0x25];
const OID_SAN = [0x55, 0x1d, 0x11];
const OID_SERVER_AUTH = [0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01];

const extension = (id: number[], critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

/**
 * The names the certificate answers to. There is no `*.localhost`: a wildcard covers one label, and OpenSSL refuses one
 * under a single-label name, so it would never match `bucket.localhost`. https to virtual-host bucket names is not supported.
 */
export const CERTIFICATE_NAMES = { dns: ["localhost"], ip: ["127.0.0.1", "::1"] };

/** How long a certificate is valid, and how long before its end a new one is made. */
export const VALID_DAYS = 2 * 365;
export const RENEW_BEFORE_DAYS = 30;

function ipBytes(ip: string): Buffer {
  if (ip.includes(":")) {
    if (ip !== "::1") throw new Error("only ::1 is supported");
    return Buffer.concat([Buffer.alloc(15), Buffer.from([1])]);
  }
  return Buffer.from(ip.split(".").map(Number));
}

export type GatewayCertificate = { cert: string; key: string };

const pem = (label: string, b: Buffer) => `-----BEGIN ${label}-----\n${b.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;

/** A new self-signed certificate and key for the Gateway (ECDSA P-256, valid from yesterday for two years). */
export function generateCertificate(now = new Date()): GatewayCertificate {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const name = seq(set(seq(oid(OID_CN), utf8("Emulator Console Gateway"))));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f; // positive
  serial[0]! |= 0x40; // and never a leading zero byte
  const notBefore = new Date(now.getTime() - 24 * 3600_000);
  const notAfter = new Date(now.getTime() + VALID_DAYS * 24 * 3600_000);
  const san = seq(
    ...CERTIFICATE_NAMES.dns.map((d) => der(0x82, Buffer.from(d, "ascii"))),
    ...CERTIFICATE_NAMES.ip.map((ip) => der(0x87, ipBytes(ip))),
  );
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // v3
    der(0x02, serial),
    seq(oid(OID_ECDSA_SHA256)),
    name,
    seq(time(notBefore), time(notAfter)),
    name,
    Buffer.from(publicKey.export({ type: "spki", format: "der" })),
    der(
      0xa3,
      seq(
        extension(OID_BASIC_CONSTRAINTS, true, seq()),
        extension(OID_KEY_USAGE, true, der(0x03, Buffer.from([0x07, 0x80]))), // digitalSignature
        extension(OID_EXT_KEY_USAGE, false, seq(oid(OID_SERVER_AUTH))),
        extension(OID_SAN, false, san),
      ),
    ),
  );
  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const certificate = seq(tbs, seq(oid(OID_ECDSA_SHA256)), der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return {
    cert: pem("CERTIFICATE", certificate),
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Writes a file that may already exist: created or truncated, never through a symlink, and set to `mode` whatever the umask. */
function writeFile(file: string, content: string, mode: number): void {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode);
  try {
    fchmodSync(fd, mode);
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

/** Whether a stored certificate and key are a pair, and the certificate has more than RENEW_BEFORE_DAYS left. */
export function usable(cert: string, key: string, now: Date): boolean {
  try {
    const x = new X509Certificate(cert);
    return x.checkPrivateKey(createPrivateKey(key)) && new Date(x.validTo).getTime() > now.getTime() + RENEW_BEFORE_DAYS * 24 * 3600_000;
  } catch {
    return false;
  }
}

/**
 * The Gateway's certificate. With a directory (GATEWAY_CERT_DIR), the same one every start, so the Developer trusts it
 * once: read from `gateway.pem` and `gateway.key`, or made and written there (key file 0600) when they are missing,
 * are not a pair, or the certificate has under 30 days left. A folder that can't be written still gives a working
 * certificate for this run. Without a directory, a new certificate each time the Console starts.
 */
export function loadCertificate(dir?: string, now = new Date()): GatewayCertificate {
  if (!dir) return generateCertificate(now);
  const certFile = path.join(dir, "gateway.pem");
  const keyFile = path.join(dir, "gateway.key");
  const cert = readSmallFileSync(certFile, 16 * 1024);
  const key = readSmallFileSync(keyFile, 16 * 1024);
  if (cert !== null && key !== null && usable(cert, key, now)) return { cert, key };
  const made = generateCertificate(now);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFile(keyFile, made.key, 0o600);
    writeFile(certFile, made.cert, 0o644);
  } catch {
    /* see above */
  }
  return made;
}
