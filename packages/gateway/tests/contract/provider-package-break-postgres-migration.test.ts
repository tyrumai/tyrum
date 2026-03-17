import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/141_provider_package_break.sql"),
  "utf8",
);

describe("provider package break postgres migration", () => {
  it("rewrites override package ids and clears cached catalog values", () => {
    const mem = newDb();

    mem.public.none(`
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

      INSERT INTO catalog_provider_overrides (tenant_id, provider_id, npm) VALUES
        ('tenant-1', 'gitlab', '@gitlab/gitlab-ai-provider'),
        ('tenant-1', 'venice', 'venice-ai-sdk-provider');

      INSERT INTO catalog_model_overrides (tenant_id, provider_id, model_id, provider_npm) VALUES
        ('tenant-1', 'gitlab', 'duo-chat', '@gitlab/gitlab-ai-provider'),
        ('tenant-1', 'venice', 'venice-large', 'venice-ai-sdk-provider');

      INSERT INTO models_dev_cache (id, json, etag, sha256, last_error) VALUES (
        1,
        '{"gitlab":{"npm":"@gitlab/gitlab-ai-provider"},"venice":{"npm":"venice-ai-sdk-provider"}}',
        'etag-1',
        'sha-1',
        'stale error'
      );
    `);

    expect(() => mem.public.none(migrationSql)).not.toThrow();

    const providerNpms = mem.public.many<{ npm: string | null }>(
      "SELECT npm FROM catalog_provider_overrides ORDER BY provider_id ASC",
    );
    expect(providerNpms).toEqual([
      { npm: "gitlab-ai-provider" },
      { npm: "@ai-sdk/openai-compatible" },
    ]);

    const modelNpms = mem.public.many<{ provider_npm: string | null }>(
      "SELECT provider_npm FROM catalog_model_overrides ORDER BY provider_id ASC",
    );
    expect(modelNpms).toEqual([
      { provider_npm: "gitlab-ai-provider" },
      { provider_npm: "@ai-sdk/openai-compatible" },
    ]);

    const cacheRows = mem.public.many<{ id: number }>("SELECT id FROM models_dev_cache");
    expect(cacheRows).toEqual([]);
  });
});
