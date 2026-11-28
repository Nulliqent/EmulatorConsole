import { describe, expect, it } from "vitest";
import { checkFetchSite, checkRequest } from "./guard.js";

describe("checkFetchSite", () => {
  it.each([undefined, "same-origin", "none"])("allows Sec-Fetch-Site %s", (site) => {
    expect(checkFetchSite({ "sec-fetch-site": site })).toBeNull();
  });

  it.each(["cross-site", "same-site", "", "weird"])("refuses Sec-Fetch-Site %j", (site) => {
    expect(checkFetchSite({ "sec-fetch-site": site })?.status).toBe(403);
  });
});

const PORT = 9298;

describe("checkRequest for requests that change something", () => {
  const host = `localhost:${PORT}`;
  const origin = `http://localhost:${PORT}`;
  const ok = { host, origin, "x-console": "1" };

  it("accepts the Console's own Origin with X-Console or a JSON body", () => {
    expect(checkRequest(ok, PORT, "POST")).toBeNull();
    expect(checkRequest({ host, origin, "content-type": "application/json; charset=utf-8" }, PORT, "POST")).toBeNull();
    expect(checkRequest({ ...ok, "sec-fetch-site": "same-origin" }, PORT, "DELETE")).toBeNull();
  });

  it("accepts no Origin only when Sec-Fetch-Site says same-origin", () => {
    expect(checkRequest({ host, "x-console": "1", "sec-fetch-site": "same-origin" }, PORT, "POST")).toBeNull();
    expect(checkRequest({ host, "x-console": "1" }, PORT, "POST")?.status).toBe(403);
    expect(checkRequest({ host, "x-console": "1", "sec-fetch-site": "none" }, PORT, "POST")?.status).toBe(403);
  });

  it.each(["cross-site", "same-site"])("refuses Sec-Fetch-Site %s", (site) => {
    expect(checkRequest({ ...ok, "sec-fetch-site": site }, PORT, "POST")?.status).toBe(403);
  });

  it("refuses a foreign Origin and a simple cross-site form post", () => {
    expect(checkRequest({ ...ok, origin: "https://evil.example" }, PORT, "POST")?.status).toBe(403);
    expect(
      checkRequest({ host, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, PORT, "POST")?.status,
    ).toBe(403);
  });

  it("refuses without X-Console or a JSON content type", () => {
    expect(checkRequest({ host, origin }, PORT, "POST")?.status).toBe(403);
    expect(checkRequest({ host, origin, "content-type": "text/plain" }, PORT, "POST")?.status).toBe(403);
  });

  it("leaves GET and HEAD alone", () => {
    expect(checkRequest({ host }, PORT, "GET")).toBeNull();
    expect(checkRequest({ host }, PORT, "HEAD")).toBeNull();
  });
});

describe("checkRequest", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])("accepts loopback host %s with the Console's port", (name) => {
    expect(checkRequest({ host: `${name}:${PORT}` }, PORT)).toBeNull();
  });

  it.each([
    undefined,
    "evil.example",
    "evil.example:9298",
    "127.0.0.1",
    "127.0.0.1:1234",
    "localhost.evil.example:9298",
    "0.0.0.0:9298",
    "192.168.1.5:9298",
  ])("refuses foreign Host %s", (host) => {
    expect(checkRequest({ host }, PORT)?.status).toBe(421);
  });

  it("accepts the Console's own Origin", () => {
    expect(checkRequest({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` }, PORT)).toBeNull();
    expect(checkRequest({ host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` }, PORT)).toBeNull();
  });

  it.each([
    "https://evil.example",
    "http://evil.example:9298",
    "http://localhost:1234",
    "https://localhost:9298",
    "null",
  ])("refuses foreign Origin %s", (origin) => {
    expect(checkRequest({ host: `localhost:${PORT}`, origin }, PORT)?.status).toBe(403);
  });
});
