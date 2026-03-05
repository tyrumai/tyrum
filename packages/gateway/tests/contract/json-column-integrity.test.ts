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
    const invalidJson = "{not valid json";

    // SQLite (real engine)
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    expect(() =>
      sqlite.prepare("INSERT INTO routing_configs (config_json) VALUES (?)").run(invalidJson),
    ).toThrow();

    expect(() =>
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
          "00000000-0000-4000-8000-000000000010",
          "watcher-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "plan.complete",
          invalidJson,
        ),
    ).toThrow();

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000011", "sha1", invalidJson),
    ).toThrow();

    sqlite.close();

    // Postgres (pg-mem)
    const { db, close } = await openTestPostgresDb();
    try {
      await expect(
        db.run("INSERT INTO routing_configs (config_json) VALUES (?)", [invalidJson]),
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
            "watcher-1",
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
          [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000011", "sha1", invalidJson],
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
