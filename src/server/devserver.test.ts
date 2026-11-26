import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../vite.config.js";

const server = config.server!;

describe("vite dev server", () => {
  it("listens on loopback only", () => {
    expect(server.host).toBe("127.0.0.1");
  });

  it("denies the files that hold the Emulator's run keys and certificates", () => {
    expect(server.fs?.deny).toEqual(
      expect.arrayContaining([".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.aws/**"]),
    );
  });

  it("allows only the UI sources, shared types and node_modules, not the repo root", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const allow = (server.fs?.allow ?? []).map((p) => path.relative(root, p));
    expect(allow.sort()).toEqual([path.join("node_modules"), path.join("src", "shared"), path.join("src", "web")].sort());
  });

  it("rewrites Host for the proxied API", () => {
    const proxy = server.proxy?.["/api"];
    expect(typeof proxy === "object" && proxy.changeOrigin).toBe(true);
  });
});
