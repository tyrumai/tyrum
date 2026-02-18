import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { filterMutableKeys } from "../src/main/ipc/config-ipc.js";

describe("filterMutableKeys", () => {
  const ALLOWED = new Set([
    "mode",
    "remote.wsUrl",
    "embedded.port",
    "embedded.dbPath",
    "capabilities.desktop",
    "capabilities.playwright",
    "capabilities.cli",
    "capabilities.http",
    "web.headless",
    "permissions.overrides",
  ]);

  it("allows top-level permitted field", () => {
    const result = filterMutableKeys({ mode: "remote" }, ALLOWED);
    expect(result).toEqual({ mode: "remote" });
  });

  it("allows nested permitted field", () => {
    const result = filterMutableKeys(
      { embedded: { port: 9090 } },
      ALLOWED,
    );
    expect(result).toEqual({ embedded: { port: 9090 } });
  });

  it("allows permitted sub-object (permissions.overrides)", () => {
    const result = filterMutableKeys(
      { permissions: { overrides: { "cli.exec": true } } },
      ALLOWED,
    );
    expect(result).toEqual({ permissions: { overrides: { "cli.exec": true } } });
  });

  it("strips permissions.profile", () => {
    const result = filterMutableKeys(
      { permissions: { profile: "poweruser" } },
      ALLOWED,
    );
    expect(result).toEqual({});
  });

  it("strips cli.allowedCommands", () => {
    const result = filterMutableKeys(
      { cli: { allowedCommands: ["rm", "curl"] } },
      ALLOWED,
    );
    expect(result).toEqual({});
  });

  it("strips cli.allowedWorkingDirs", () => {
    const result = filterMutableKeys(
      { cli: { allowedWorkingDirs: ["/"] } },
      ALLOWED,
    );
    expect(result).toEqual({});
  });

  it("strips web.allowedDomains", () => {
    const result = filterMutableKeys(
      { web: { allowedDomains: ["evil.com"] } },
      ALLOWED,
    );
    expect(result).toEqual({});
  });

  it("strips embedded.tokenRef", () => {
    const result = filterMutableKeys(
      { embedded: { tokenRef: "stolen-token" } },
      ALLOWED,
    );
    expect(result).toEqual({});
  });

  it("strips remote.tokenRef", () => {
    const result = filterMutableKeys(
      { remote: { tokenRef: "stolen" } },
      ALLOWED,
    );
    expect(result).toEqual({});
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
      permissions: { overrides: { x: true } },
      embedded: { port: 3000 },
    });
  });

  it("returns empty object for non-object partial", () => {
    // The handler validates before calling, but filterMutableKeys should be safe
    const result = filterMutableKeys({}, ALLOWED);
    expect(result).toEqual({});
  });
});
