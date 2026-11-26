import { describe, expect, it } from "vitest";
import { checkRequest } from "./guard.js";

const PORT = 9298;

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
