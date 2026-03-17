import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/141_provider_package_break.sql"),
  "utf8",
);

describe("sqlite provider package break migration", () => {
  it("rewrites stored provider package ids and clears cached catalog values", () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE catalog_provider_overrides (
          tenant_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          npm TEXT NULL
        );
        CREATE TABLE catalog_model_overrides (
          tenant_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          provider_npm TEXT NULL
        );
        CREATE TABLE models_dev_cache (
          id INTEGER PRIMARY KEY,
          json TEXT NOT NULL,
          etag TEXT NULL,
          sha256 TEXT NOT NULL,
          last_error TEXT NULL
        );
      `);

      sqlite
        .prepare(
          "INSERT INTO catalog_provider_overrides (tenant_id, provider_id, npm) VALUES (?, ?, ?)",
        )
        .run("tenant-1", "gitlab", "@gitlab/gitlab-ai-provider");
      sqlite
        .prepare(
          "INSERT INTO catalog_provider_overrides (tenant_id, provider_id, npm) VALUES (?, ?, ?)",
        )
        .run("tenant-1", "venice", "venice-ai-sdk-provider");
      sqlite
        .prepare(
          "INSERT INTO catalog_model_overrides (tenant_id, provider_id, model_id, provider_npm) VALUES (?, ?, ?, ?)",
        )
        .run("tenant-1", "gitlab", "duo-chat", "@gitlab/gitlab-ai-provider");
      sqlite
        .prepare(
          "INSERT INTO catalog_model_overrides (tenant_id, provider_id, model_id, provider_npm) VALUES (?, ?, ?, ?)",
        )
        .run("tenant-1", "venice", "venice-large", "venice-ai-sdk-provider");
      sqlite
        .prepare(
          "INSERT INTO models_dev_cache (id, json, etag, sha256, last_error) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          1,
          JSON.stringify({
            gitlab: { npm: "@gitlab/gitlab-ai-provider" },
            venice: { npm: "venice-ai-sdk-provider" },
          }),
          "etag-1",
          "sha-1",
          "stale error",
        );

      expect(() => sqlite.exec(migrationSql)).not.toThrow();

      const providerNpms = sqlite
        .prepare("SELECT npm FROM catalog_provider_overrides ORDER BY provider_id ASC")
        .all() as Array<{ npm: string | null }>;
      expect(providerNpms).toEqual([
        { npm: "gitlab-ai-provider" },
        { npm: "@ai-sdk/openai-compatible" },
      ]);

      const modelNpms = sqlite
        .prepare("SELECT provider_npm FROM catalog_model_overrides ORDER BY provider_id ASC")
        .all() as Array<{ provider_npm: string | null }>;
      expect(modelNpms).toEqual([
        { provider_npm: "gitlab-ai-provider" },
        { provider_npm: "@ai-sdk/openai-compatible" },
      ]);

      const cacheRows = sqlite.prepare("SELECT id FROM models_dev_cache").all() as Array<{
        id: number;
      }>;
      expect(cacheRows).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
