import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDatabaseDirectory } from "../../src/index.js";

describe("ensureDatabaseDirectory", () => {
  it("creates missing parent directories for filesystem db paths", () => {
    const root = mkdtempSync(join(tmpdir(), "tyrum-gateway-dbdir-"));
    try {
      const targetDir = join(root, "nested", "gateway");
      const dbPath = join(targetDir, "gateway.db");
      expect(existsSync(targetDir)).toBe(false);

      ensureDatabaseDirectory(dbPath);

      expect(existsSync(targetDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is a no-op for ':memory:' db paths", () => {
    expect(() => ensureDatabaseDirectory(":memory:")).not.toThrow();
  });

  it("is a no-op for sqlite file URI paths", () => {
    expect(() => ensureDatabaseDirectory("file:gateway.db?mode=memory")).not.toThrow();
  });

  it("is a no-op for Postgres db URIs", () => {
    const root = mkdtempSync(join(tmpdir(), "tyrum-gateway-dburi-"));
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => ensureDatabaseDirectory("postgres://user:pass@localhost:5432/db")).not.toThrow();
      expect(existsSync(join(root, "postgres:"))).toBe(false);
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
