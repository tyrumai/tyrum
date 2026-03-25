/**
 * bootstrap/config.ts — unit tests for bootstrap configuration helpers.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  assertSplitRoleUsesPostgres,
  ensureDatabaseDirectory,
  resolveDesktopTakeoverAdvertiseOrigin,
  resolveGatewayHome,
} from "../../src/bootstrap/config.js";

describe("assertSplitRoleUsesPostgres", () => {
  it("does not throw for role 'all'", () => {
    expect(() => assertSplitRoleUsesPostgres("all", "/path/db.sqlite")).not.toThrow();
  });

  it("does not throw for split roles with postgres URI", () => {
    expect(() => assertSplitRoleUsesPostgres("edge", "postgres://localhost/db")).not.toThrow();
  });

  it("throws for split roles with non-postgres path", () => {
    expect(() => assertSplitRoleUsesPostgres("edge", "/path/db.sqlite")).toThrow(
      /requires Postgres/,
    );
  });

  it("throws for worker role with sqlite path", () => {
    expect(() => assertSplitRoleUsesPostgres("worker", ":memory:")).toThrow(/requires Postgres/);
  });

  it("throws for scheduler role with sqlite path", () => {
    expect(() => assertSplitRoleUsesPostgres("scheduler", "/tmp/test.db")).toThrow(
      /requires Postgres/,
    );
  });
});

describe("ensureDatabaseDirectory", () => {
  it("does nothing for empty string", () => {
    expect(() => ensureDatabaseDirectory("")).not.toThrow();
  });

  it("does nothing for :memory:", () => {
    expect(() => ensureDatabaseDirectory(":memory:")).not.toThrow();
  });

  it("does nothing for file: URIs", () => {
    expect(() => ensureDatabaseDirectory("file:test.db")).not.toThrow();
  });

  it("does nothing for postgres URIs", () => {
    expect(() => ensureDatabaseDirectory("postgres://host/db")).not.toThrow();
  });

  it("does nothing for relative paths with no parent directory", () => {
    expect(() => ensureDatabaseDirectory("test.db")).not.toThrow();
  });

  it("creates parent directory for paths with directories", () => {
    // Use /tmp which should always be writable
    expect(() => ensureDatabaseDirectory("/tmp/tyrum-test-dir-abc/test.db")).not.toThrow();
  });
});

describe("resolveGatewayHome", () => {
  const originalEnv = process.env["TYRUM_HOME"];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["TYRUM_HOME"] = originalEnv;
    } else {
      delete process.env["TYRUM_HOME"];
    }
  });

  it("returns the override when provided", () => {
    expect(resolveGatewayHome("/custom/home")).toBe("/custom/home");
  });

  it("trims whitespace from the override", () => {
    expect(resolveGatewayHome("  /custom/home  ")).toBe("/custom/home");
  });

  it("ignores empty override and uses TYRUM_HOME env", () => {
    process.env["TYRUM_HOME"] = "/env/home";
    expect(resolveGatewayHome("")).toContain("/env/home");
  });

  it("ignores whitespace-only override and uses TYRUM_HOME env", () => {
    process.env["TYRUM_HOME"] = "/env/home";
    expect(resolveGatewayHome("   ")).toContain("/env/home");
  });

  it("falls back to ~/.tyrum when no override and no env", () => {
    delete process.env["TYRUM_HOME"];
    const result = resolveGatewayHome();
    expect(result).toContain(".tyrum");
  });
});

describe("resolveDesktopTakeoverAdvertiseOrigin", () => {
  it("normalizes a bare host origin", () => {
    expect(resolveDesktopTakeoverAdvertiseOrigin("https://desktop-host.example.test")).toBe(
      "https://desktop-host.example.test/",
    );
  });

  it("rejects explicit ports", () => {
    expect(() =>
      resolveDesktopTakeoverAdvertiseOrigin("https://desktop-host.example.test:8443"),
    ).toThrow(/must not include an explicit port/);
  });
});
