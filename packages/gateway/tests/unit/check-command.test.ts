import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("tyrum check", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prints DB diagnostics and closes the database connection", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { SqliteDb } = await import("../../src/statestore/sqlite.js");
    const closeSpy = vi.spyOn(SqliteDb.prototype, "close");

    try {
      const { runCli } = await import("../../src/index.js");
      const code = await runCli(["check", "--home", home, "--db", ":memory:"]);

      expect(code).toBe(0);
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("check: failed"));
      expect(closeSpy).toHaveBeenCalledTimes(1);

      const output = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("check: ok");
      expect(output).toContain("db: kind=sqlite path=:memory:");
      expect(output).toContain("deployment_config:");
      expect(output).toContain("auth_tokens:");
    } finally {
      closeSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  it("closes the database connection on check failure", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-check-fail-"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { SqliteDb } = await import("../../src/statestore/sqlite.js");
    const closeSpy = vi.spyOn(SqliteDb.prototype, "close");
    const { AuthTokenService } = await import("../../src/modules/auth/auth-token-service.js");
    const authSpy = vi
      .spyOn(AuthTokenService.prototype, "countActiveSystemTokens")
      .mockRejectedValue(new Error("boom"));

    try {
      const { runCli } = await import("../../src/index.js");
      const code = await runCli(["check", "--home", home, "--db", ":memory:"]);

      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("check: failed"));
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("check: ok"));
    } finally {
      authSpy.mockRestore();
      closeSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);
});
