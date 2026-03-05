import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/migrate.js";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");

describe("SQLite index hygiene", () => {
  it("does not keep indexes that duplicate primary-key coverage", () => {
    const sqlite = createDatabase(":memory:");
    try {
      migrate(sqlite, sqliteMigrationsDir);

      const rows = sqlite
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'index'
             AND name IN (
               'deployment_configs_revision_idx',
               'oauth_provider_configs_tenant_provider_idx',
               'catalog_provider_overrides_tenant_provider_idx',
               'catalog_model_overrides_tenant_provider_idx'
             )
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>;

      expect(rows).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("drops redundant indexes from databases migrated before the cleanup", () => {
    const sqlite = createDatabase(":memory:");
    const preCleanupDir = mkdtempSync(join(tmpdir(), "tyrum-sqlite-pre-cleanup-"));
    try {
      for (const file of readdirSync(sqliteMigrationsDir)
        .filter((name) => name.endsWith(".sql") && name < "108_")
        .sort()) {
        copyFileSync(join(sqliteMigrationsDir, file), join(preCleanupDir, file));
      }

      migrate(sqlite, preCleanupDir);
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS deployment_configs_revision_idx ON deployment_configs (revision DESC);
        CREATE INDEX IF NOT EXISTS oauth_provider_configs_tenant_provider_idx ON oauth_provider_configs (tenant_id, provider_id);
        CREATE INDEX IF NOT EXISTS catalog_provider_overrides_tenant_provider_idx ON catalog_provider_overrides (tenant_id, provider_id);
        CREATE INDEX IF NOT EXISTS catalog_model_overrides_tenant_provider_idx ON catalog_model_overrides (tenant_id, provider_id);
      `);

      migrate(sqlite, sqliteMigrationsDir);

      const rows = sqlite
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'index'
             AND name IN (
               'deployment_configs_revision_idx',
               'oauth_provider_configs_tenant_provider_idx',
               'catalog_provider_overrides_tenant_provider_idx',
               'catalog_model_overrides_tenant_provider_idx'
             )
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>;

      expect(rows).toEqual([]);
    } finally {
      rmSync(preCleanupDir, { recursive: true, force: true });
      sqlite.close();
    }
  });
});
