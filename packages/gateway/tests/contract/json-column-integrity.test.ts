import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../../src/migrate.js";
import { createDatabase } from "../../src/db.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");

describe("JSON column integrity (sqlite vs postgres)", () => {
  it("rejects invalid JSON in high-value TEXT JSON columns", async () => {
    const validJson = JSON.stringify({ ok: true });
    const invalidJson = "{not valid json";

    // SQLite (real engine)
    const sqlite = createDatabase(":memory:");
    try {
      migrate(sqlite, sqliteMigrationsDir);

      const insertRoutingConfig = (configJson: string) =>
        sqlite
          .prepare("INSERT INTO routing_configs (tenant_id, config_json) VALUES (?, ?)")
          .run(DEFAULT_TENANT_ID, configJson);

      expect(() => insertRoutingConfig(validJson)).not.toThrow();
      expect(() => insertRoutingConfig(invalidJson)).toThrow();

      const insertWatcher = (input: {
        watcherId: string;
        watcherKey: string;
        triggerConfigJson: string;
      }) =>
        sqlite
          .prepare(
            `INSERT INTO watchers (
               tenant_id,
               watcher_id,
               watcher_key,
               agent_id,
               workspace_id,
               trigger_type,
               trigger_config_json
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            DEFAULT_TENANT_ID,
            input.watcherId,
            input.watcherKey,
            DEFAULT_AGENT_ID,
            DEFAULT_WORKSPACE_ID,
            "plan.complete",
            input.triggerConfigJson,
          );

      expect(() =>
        insertWatcher({
          watcherId: "00000000-0000-4000-8000-000000000010",
          watcherKey: "watcher-valid",
          triggerConfigJson: validJson,
        }),
      ).not.toThrow();

      expect(() =>
        insertWatcher({
          watcherId: "00000000-0000-4000-8000-000000000011",
          watcherKey: "watcher-invalid",
          triggerConfigJson: invalidJson,
        }),
      ).toThrow();

      const insertPolicySnapshot = (input: {
        policySnapshotId: string;
        sha256: string;
        bundleJson: string;
      }) =>
        sqlite
          .prepare(
            `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
             VALUES (?, ?, ?, ?)`,
          )
          .run(DEFAULT_TENANT_ID, input.policySnapshotId, input.sha256, input.bundleJson);

      expect(() =>
        insertPolicySnapshot({
          policySnapshotId: "00000000-0000-4000-8000-000000000020",
          sha256: "sha-valid",
          bundleJson: validJson,
        }),
      ).not.toThrow();

      expect(() =>
        insertPolicySnapshot({
          policySnapshotId: "00000000-0000-4000-8000-000000000021",
          sha256: "sha-invalid",
          bundleJson: invalidJson,
        }),
      ).toThrow();

      const insertChannelConfig = (configJson: string) =>
        sqlite
          .prepare(
            "INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json) VALUES (?, 'telegram', ?, ?)",
          )
          .run(DEFAULT_TENANT_ID, "work", configJson);

      expect(() => insertChannelConfig(validJson)).not.toThrow();
      expect(() => insertChannelConfig(invalidJson)).toThrow();
    } finally {
      sqlite.close();
    }

    // Postgres (pg-mem)
    const { db, close } = await openTestPostgresDb();
    try {
      await expect(
        db.run("INSERT INTO routing_configs (tenant_id, config_json) VALUES (?, ?)", [
          DEFAULT_TENANT_ID,
          validJson,
        ]),
      ).resolves.toBeDefined();

      await expect(
        db.run("INSERT INTO routing_configs (tenant_id, config_json) VALUES (?, ?)", [
          DEFAULT_TENANT_ID,
          invalidJson,
        ]),
      ).rejects.toThrow();

      await expect(
        db.run(
          `INSERT INTO watchers (
             tenant_id,
             watcher_id,
             watcher_key,
             agent_id,
             workspace_id,
             trigger_type,
             trigger_config_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            DEFAULT_TENANT_ID,
            "00000000-0000-4000-8000-000000000010",
            "watcher-valid",
            DEFAULT_AGENT_ID,
            DEFAULT_WORKSPACE_ID,
            "plan.complete",
            validJson,
          ],
        ),
      ).resolves.toBeDefined();

      await expect(
        db.run(
          `INSERT INTO watchers (
             tenant_id,
             watcher_id,
             watcher_key,
             agent_id,
             workspace_id,
             trigger_type,
             trigger_config_json
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            DEFAULT_TENANT_ID,
            "00000000-0000-4000-8000-000000000011",
            "watcher-invalid",
            DEFAULT_AGENT_ID,
            DEFAULT_WORKSPACE_ID,
            "plan.complete",
            invalidJson,
          ],
        ),
      ).rejects.toThrow();

      await expect(
        db.run(
          `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
           VALUES (?, ?, ?, ?)`,
          [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000020", "sha-valid", validJson],
        ),
      ).resolves.toBeDefined();

      await expect(
        db.run(
          `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
           VALUES (?, ?, ?, ?)`,
          [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000021", "sha-invalid", invalidJson],
        ),
      ).rejects.toThrow();

      await expect(
        db.run(
          `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
           VALUES (?, 'telegram', ?, ?)`,
          [DEFAULT_TENANT_ID, "work", validJson],
        ),
      ).resolves.toBeDefined();

      await expect(
        db.run(
          `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
           VALUES (?, 'telegram', ?, ?)`,
          [DEFAULT_TENANT_ID, "personal", invalidJson],
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });

  it("enforces tenant-scoped unique telegram webhook secrets", async () => {
    const firstConfigJson = JSON.stringify({
      channel: "telegram",
      account_key: "work",
      webhook_secret: "shared-secret",
      allowed_user_ids: [],
      pipeline_enabled: true,
    });
    const secondConfigJson = JSON.stringify({
      channel: "telegram",
      account_key: "personal",
      webhook_secret: "shared-secret",
      allowed_user_ids: [],
      pipeline_enabled: true,
    });

    const sqlite = createDatabase(":memory:");
    try {
      migrate(sqlite, sqliteMigrationsDir);

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
             VALUES (?, 'telegram', ?, ?)`,
          )
          .run(DEFAULT_TENANT_ID, "work", firstConfigJson),
      ).not.toThrow();

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
             VALUES (?, 'telegram', ?, ?)`,
          )
          .run(DEFAULT_TENANT_ID, "personal", secondConfigJson),
      ).toThrow();
    } finally {
      sqlite.close();
    }

    const { db, close } = await openTestPostgresDb();
    try {
      await expect(
        db.run(
          `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
           VALUES (?, 'telegram', ?, ?)`,
          [DEFAULT_TENANT_ID, "work", firstConfigJson],
        ),
      ).resolves.toBeDefined();

      await expect(
        db.run(
          `INSERT INTO channel_configs (tenant_id, connector_key, account_key, config_json)
           VALUES (?, 'telegram', ?, ?)`,
          [DEFAULT_TENANT_ID, "personal", secondConfigJson],
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
