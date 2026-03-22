import { describe, expect, it } from "vitest";

describe("gateway entrypoint (src/index.ts)", () => {
  it("can be imported without auto-starting the server", async () => {
    const originalArgv1 = process.argv[1];
    process.argv[1] = "/vitest";
    try {
      const mod = await import("../../src/index.js");

      expect(mod.VERSION).toBeTypeOf("string");
      expect(mod.createApp).toBeTypeOf("function");
      expect(mod.createContainer).toBeTypeOf("function");
      expect(mod.ConnectionManager).toBeTypeOf("function");
      expect(mod.applyStartCommandDeploymentOverrides).toBeTypeOf("function");
      expect(mod.assertSplitRoleUsesPostgres).toBeTypeOf("function");
      expect(mod.buildStartupDefaultDeploymentConfig).toBeTypeOf("function");
      expect(mod.ensureDatabaseDirectory).toBeTypeOf("function");
      expect(mod.runCli).toBeTypeOf("function");
      expect(mod.main).toBeTypeOf("function");
      expect(mod.formatFatalErrorForConsole).toBeTypeOf("function");
      expect(mod.resolveSnapshotImportEnabled).toBeTypeOf("function");
      expect(mod.splitHostAndPort).toBeTypeOf("function");
    } finally {
      process.argv[1] = originalArgv1;
    }
  }, 30_000);
});
