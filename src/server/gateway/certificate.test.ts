import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateCertificate, loadCertificate, usable, VALID_DAYS } from "./certificate.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "cert-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the Gateway's certificate", () => {
  it("is a leaf for localhost, 127.0.0.1 and ::1 only, valid for two years", () => {
    const c = generateCertificate();
    const x = new X509Certificate(c.cert);
    expect(x.ca).toBe(false);
    expect(x.subjectAltName).toBe("DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1");
    expect(x.subjectAltName).not.toContain("*");
    expect(x.checkHost("localhost")).toBe("localhost");
    expect(x.checkIP("127.0.0.1")).toBe("127.0.0.1");
    const days = (new Date(x.validTo).getTime() - new Date(x.validFrom).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(VALID_DAYS + 1);
  });

  it("writes dates from 2050 as GeneralizedTime", () => {
    const c = generateCertificate(new Date("2050-03-01T00:00:00Z"));
    const x = new X509Certificate(c.cert);
    expect(new Date(x.validFrom).getUTCFullYear()).toBe(2050);
    expect(new Date(x.validTo).getUTCFullYear()).toBe(2052);
    const cert1999 = new X509Certificate(generateCertificate(new Date("2049-12-30T00:00:00Z")).cert);
    expect(new Date(cert1999.validTo).getUTCFullYear()).toBe(2051);
  });

  it("stays the same across starts when it has a folder, with the key readable by its owner only", () => {
    const dir = tmp();
    const first = loadCertificate(dir);
    const second = loadCertificate(dir);
    expect(second).toEqual(first);
    expect(statSync(path.join(dir, "gateway.key")).mode & 0o777).toBe(0o600);
    expect(readFileSync(path.join(dir, "gateway.pem"), "utf8")).toBe(first.cert);
    expect(loadCertificate()).not.toEqual(loadCertificate());
  });

  it("makes a new one, instead of failing, when the key and certificate are not a pair or the certificate is about to expire", () => {
    const dir = tmp();
    const first = loadCertificate(dir);
    writeFileSync(path.join(dir, "gateway.key"), generateCertificate().key);
    expect(usable(first.cert, readFileSync(path.join(dir, "gateway.key"), "utf8"), new Date())).toBe(false);
    const repaired = loadCertificate(dir);
    expect(repaired.cert).not.toBe(first.cert);
    expect(usable(repaired.cert, repaired.key, new Date())).toBe(true);
    expect(loadCertificate(dir)).toEqual(repaired);

    const later = new Date(Date.now() + (VALID_DAYS - 10) * 86_400_000);
    expect(loadCertificate(dir, later).cert).not.toBe(repaired.cert);
    writeFileSync(path.join(dir, "gateway.pem"), "not a certificate");
    expect(usable("not a certificate", repaired.key, new Date())).toBe(false);
    expect(loadCertificate(dir).cert).toContain("BEGIN CERTIFICATE");
  });

  it("does not follow a symlink for the key, and still gives a working certificate", () => {
    const dir = tmp();
    const target = path.join(tmp(), "victim");
    writeFileSync(target, "keep me");
    symlinkSync(target, path.join(dir, "gateway.key"));
    const c = loadCertificate(dir);
    expect(readFileSync(target, "utf8")).toBe("keep me");
    expect(usable(c.cert, c.key, new Date())).toBe(true);
  });
});
