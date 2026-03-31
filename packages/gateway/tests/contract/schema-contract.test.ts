import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../../src/migrate.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { createDatabase } from "../../src/db.js";
import { getPostgresColumns, getSqliteColumns } from "../helpers/schema-introspection.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

describe("StateStore schema contract (sqlite vs postgres)", () => {
  it("keeps core table column sets aligned", async () => {
    // SQLite (real engine)
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    // Postgres (pg-mem, node-postgres adapter)
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await migratePostgres(pg, postgresMigrationsDir);

      const tables = [
        "planner_events",
        "vector_metadata",
        // Memory v1 canonical persistence (issue #652)
        "memory_items",
        "memory_item_provenance",
        "memory_item_tags",
        "memory_tombstones",
        "memory_item_embeddings",
        "watchers",
        "watcher_firings",
        "channel_accounts",
        "channel_threads",
        "conversations",
        "conversation_state",
        "transcript_events",
        "peer_identity_links",
        "approvals",
        "canvas_artifacts",
        "outbox",
        "outbox_consumers",
        "ws_events",
        "connections",
        "presence_entries",
        "node_pairings",
        "policy_snapshots",
        "policy_overrides",
        "routing_configs",
        "channel_configs",
        "auth_profiles",
        "conversation_model_overrides",
        "conversation_provider_pins",
        "conversation_send_policy_overrides",
        "conversation_queue_overrides",
        "conversation_queue_signals",
        "configured_model_presets",
        "execution_profile_model_assignments",
        "context_reports",
        "secret_resolutions",
        "turn_jobs",
        "turns",
        "turn_items",
        "execution_steps",
        "execution_attempts",
        "artifacts",
        "artifact_access",
        "artifact_links",
        "channel_inbox",
        "channel_outbox",
        "concurrency_slots",
        "conversation_leases",
        "idempotency_records",
        "resume_tokens",
        // WorkBoard (issue #600)
        "work_items",
        "work_item_tasks",
        "work_item_events",
        "work_item_links",
        "work_artifacts",
        "work_decisions",
        "work_signals",
        "work_signal_firings",
        "work_item_state_kv",
        "agent_state_kv",
        "subagents",
        "work_scope_activity",
        "conversation_node_attachments",
      ] as const;

      for (const table of tables) {
        const sqliteCols = getSqliteColumns(sqlite, table);
        const pgCols = await getPostgresColumns(pg, table);
        expect(sqliteCols.length, `sqlite columns for ${table}`).toBeGreaterThan(0);
        expect(pgCols.length, `postgres columns for ${table}`).toBeGreaterThan(0);
        sqliteCols.sort();
        pgCols.sort();
        expect(pgCols, `postgres columns for ${table}`).toEqual(sqliteCols);
      }
    } finally {
      await pg.end();
      sqlite.close();
    }
  });
});
