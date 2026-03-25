import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/db.js";
import { ModelsDevCacheDal } from "../../src/modules/models/models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "../../src/modules/models/models-dev-refresh-lease-dal.js";
import {
  ModelsDevService,
  type ModelsDevLoadResult,
} from "../../src/modules/models/models-dev-service.js";
import { PUBLIC_EXECUTION_PROFILE_IDS } from "../../src/modules/models/public-execution-profiles.js";
import { loadConfigHealth } from "../../src/modules/observability/config-health.js";
import type { SqlDb } from "../../src/statestore/types.js";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function openBareSqliteDb(): SqlDb {
  const raw = createDatabase(":memory:");

  const db: SqlDb = {
    kind: "sqlite",
    get: async (sql, params = []) => raw.prepare(sql).get(...params) as never,
    all: async (sql, params = []) => raw.prepare(sql).all(...params) as never[],
    run: async (sql, params = []) => {
      const res = raw.prepare(sql).run(...params);
      return { changes: res.changes };
    },
    exec: async (sql) => {
      raw.exec(sql);
    },
    transaction: async (fn) => {
      return await fn(db);
    },
    close: async () => {
      raw.close();
    },
  };

  return db;
}

async function createConfigHealthTables(db: SqlDb): Promise<void> {
  await db.exec(
    `CREATE TABLE policy_bundle_config_revisions (
       tenant_id TEXT NOT NULL,
       scope_kind TEXT NOT NULL,
       agent_id TEXT NULL,
       revision INTEGER NOT NULL,
       bundle_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       created_by_json TEXT NOT NULL,
       reason TEXT NULL
     );`,
  );
  await db.exec(
    `CREATE TABLE auth_profiles (
       tenant_id TEXT NOT NULL,
       auth_profile_id TEXT NOT NULL,
       auth_profile_key TEXT NOT NULL,
       provider_key TEXT NOT NULL,
       type TEXT NOT NULL,
       labels_json TEXT NOT NULL,
       status TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );`,
  );
  await db.exec(
    `CREATE TABLE configured_model_presets (
       tenant_id TEXT NOT NULL,
       preset_id TEXT NOT NULL,
       preset_key TEXT NOT NULL,
       display_name TEXT NOT NULL,
       provider_key TEXT NOT NULL,
       model_id TEXT NOT NULL,
       options_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );`,
  );
  await db.exec(
    `CREATE TABLE execution_profile_model_assignments (
       tenant_id TEXT NOT NULL,
       execution_profile_id TEXT NOT NULL,
       preset_key TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );`,
  );
  await db.exec(
    `CREATE TABLE agents (
       tenant_id TEXT NOT NULL,
       agent_id TEXT NOT NULL,
       agent_key TEXT NOT NULL
     );`,
  );
  await db.exec(
    `CREATE TABLE agent_configs (
       tenant_id TEXT NOT NULL,
       agent_id TEXT NOT NULL,
       revision INTEGER NOT NULL,
       config_json TEXT NULL
     );`,
  );
}

describe("loadConfigHealth", () => {
  let db: SqlDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("surfaces catalog refresh failures even when a cached catalog is still usable", async () => {
    db = openBareSqliteDb();
    await createConfigHealthTables(db);

    await db.run(
      `INSERT INTO policy_bundle_config_revisions (
         tenant_id, scope_kind, agent_id, revision, bundle_json, created_at, created_by_json, reason
       ) VALUES (?, 'deployment', NULL, 1, ?, ?, ?, ?)`,
      [
        TEST_TENANT_ID,
        JSON.stringify({
          v: 1,
          tools: { default: "allow", allow: [], require_approval: [], deny: [] },
        }),
        "2026-03-25T00:00:00.000Z",
        JSON.stringify({ kind: "test" }),
        "config-health-catalog-refresh-failure",
      ],
    );

    await db.run(
      `INSERT INTO auth_profiles (
         tenant_id,
         auth_profile_id,
         auth_profile_key,
         provider_key,
         type,
         labels_json,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        TEST_TENANT_ID,
        "11111111-1111-4111-8111-111111111111",
        "openai-primary",
        "openai",
        "api_key",
        "{}",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
      ],
    );

    await db.run(
      `INSERT INTO configured_model_presets (
         tenant_id,
         preset_id,
         preset_key,
         display_name,
         provider_key,
         model_id,
         options_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TEST_TENANT_ID,
        "22222222-2222-4222-8222-222222222222",
        "starter",
        "Starter",
        "openai",
        "gpt-4.1",
        "{}",
        "2026-03-25T00:00:00.000Z",
        "2026-03-25T00:00:00.000Z",
      ],
    );

    for (const executionProfileId of PUBLIC_EXECUTION_PROFILE_IDS) {
      await db.run(
        `INSERT INTO execution_profile_model_assignments (
           tenant_id,
           execution_profile_id,
           preset_key,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          TEST_TENANT_ID,
          executionProfileId,
          "starter",
          "2026-03-25T00:00:00.000Z",
          "2026-03-25T00:00:00.000Z",
        ],
      );
    }

    const modelsDev = new ModelsDevService({
      cacheDal: new ModelsDevCacheDal(db),
      leaseDal: new ModelsDevRefreshLeaseDal(db),
    });
    const loadedCatalog = {
      catalog: {
        openai: {
          id: "openai",
          name: "OpenAI",
          env: [],
          npm: "@ai-sdk/openai",
          models: {
            "gpt-4.1": {
              id: "gpt-4.1",
              name: "GPT-4.1",
            },
          },
        },
      },
      status: {
        source: "remote",
        fetched_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-25T00:00:00.000Z",
        etag: null,
        sha256: "a".repeat(64),
        provider_count: 1,
        model_count: 1,
        last_error: "models.dev fetch failed (502): upstream unavailable",
      },
    } satisfies ModelsDevLoadResult;
    vi.spyOn(modelsDev, "ensureLoaded").mockResolvedValue(loadedCatalog);

    const health = await loadConfigHealth({
      db,
      tenantId: TEST_TENANT_ID,
      modelsDev,
    });

    expect(health.status).toBe("issues");
    expect(health.issues).toHaveLength(1);
    expect(health.issues[0]).toEqual(
      expect.objectContaining({
        code: "model_catalog_refresh_failed",
        severity: "warning",
        target: { kind: "deployment", id: null },
      }),
    );
    expect(health.issues[0]?.message).toContain("Model catalog refresh failed");
    expect(health.issues[0]?.message).toContain("cached catalog snapshot");
  });
});
