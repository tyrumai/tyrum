import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { filterMutableKeys } from "../src/main/ipc/config-ipc.js";

describe("filterMutableKeys", () => {
  const ALLOWED = new Set([
    "mode",
    "remote.wsUrl",
    "remote.tokenRef",
    "remote.tlsCertFingerprint256",
    "embedded.port",
    "embedded.dbPath",
    "permissions.profile",
    "capabilities.desktop",
    "capabilities.playwright",
    "capabilities.cli",
    "capabilities.http",
    "cli.allowedCommands",
    "cli.allowedWorkingDirs",
    "web.allowedDomains",
    "web.headless",
    "permissions.overrides",
  ]);

  it("allows top-level permitted field", () => {
    const result = filterMutableKeys({ mode: "remote" }, ALLOWED);
    expect(result).toEqual({ mode: "remote" });
  });

  it("allows nested permitted field", () => {
    const result = filterMutableKeys({ embedded: { port: 9090 } }, ALLOWED);
    expect(result).toEqual({ embedded: { port: 9090 } });
  });

  it("allows permitted sub-object (permissions.overrides)", () => {
    const result = filterMutableKeys({ permissions: { overrides: { "cli.exec": true } } }, ALLOWED);
    expect(result).toEqual({ permissions: { overrides: { "cli.exec": true } } });
  });

  it("allows permissions.profile", () => {
    const result = filterMutableKeys({ permissions: { profile: "poweruser" } }, ALLOWED);
    expect(result).toEqual({ permissions: { profile: "poweruser" } });
  });

  it("allows cli.allowedCommands", () => {
    const result = filterMutableKeys({ cli: { allowedCommands: ["rm", "curl"] } }, ALLOWED);
    expect(result).toEqual({ cli: { allowedCommands: ["rm", "curl"] } });
  });

  it("allows cli.allowedWorkingDirs", () => {
    const result = filterMutableKeys({ cli: { allowedWorkingDirs: ["/"] } }, ALLOWED);
    expect(result).toEqual({ cli: { allowedWorkingDirs: ["/"] } });
  });

  it("allows web.allowedDomains", () => {
    const result = filterMutableKeys({ web: { allowedDomains: ["evil.com"] } }, ALLOWED);
    expect(result).toEqual({ web: { allowedDomains: ["evil.com"] } });
  });

  it("strips embedded.tokenRef", () => {
    const result = filterMutableKeys({ embedded: { tokenRef: "stolen-token" } }, ALLOWED);
    expect(result).toEqual({});
  });

  it("allows remote.tokenRef", () => {
    const result = filterMutableKeys({ remote: { tokenRef: "stolen" } }, ALLOWED);
    expect(result).toEqual({ remote: { tokenRef: "stolen" } });
  });

  it("allows remote.tlsCertFingerprint256", () => {
    const result = filterMutableKeys({ remote: { tlsCertFingerprint256: "AA:BB" } }, ALLOWED);
    expect(result).toEqual({ remote: { tlsCertFingerprint256: "AA:BB" } });
  });

  it("strips version field", () => {
    const result = filterMutableKeys({ version: 2 }, ALLOWED);
    expect(result).toEqual({});
  });

  it("handles mixed allowed and denied fields", () => {
    const result = filterMutableKeys(
      {
        mode: "embedded",
        permissions: { profile: "poweruser", overrides: { x: true } },
        embedded: { port: 3000, tokenRef: "bad" },
      },
      ALLOWED,
    );
    expect(result).toEqual({
      mode: "embedded",
      permissions: { profile: "poweruser", overrides: { x: true } },
      embedded: { port: 3000 },
    });
  });

  it("returns empty object for non-object partial", () => {
    // The handler validates before calling, but filterMutableKeys should be safe
    const result = filterMutableKeys({}, ALLOWED);
    expect(result).toEqual({});
  });

  it("handles deeply nested objects (3+ levels) — keeps only allowed leaf paths", () => {
    const DEEP_ALLOWED = new Set(["a.b.c.d"]);
    const result = filterMutableKeys(
      { a: { b: { c: { d: "deep-value", e: "blocked" }, x: 1 } } },
      DEEP_ALLOWED,
    );
    expect(result).toEqual({ a: { b: { c: { d: "deep-value" } } } });
  });

  it("treats arrays as leaf values (not recursed into)", () => {
    const result = filterMutableKeys({ cli: { allowedCommands: ["git", "ls", "cat"] } }, ALLOWED);
    expect(result).toEqual({ cli: { allowedCommands: ["git", "ls", "cat"] } });
  });

  it("treats null as a leaf value", () => {
    // null at an allowed path should be kept as-is
    const result = filterMutableKeys({ mode: null }, ALLOWED);
    expect(result).toEqual({ mode: null });
  });

  it("drops null at a disallowed path", () => {
    const result = filterMutableKeys({ version: null }, ALLOWED);
    expect(result).toEqual({});
  });
});
