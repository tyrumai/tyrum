import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const MIGRATIONS_BEFORE_SESSIONS_AGENT_ID = [
  "001_init.sql",
  "001b_backfill_baseline_tables.sql",
  "002_inbound_dedupe_composite_pk.sql",
  "003_policy_overrides_policy_snapshot_id_text.sql",
  "004_capability_memories_unique_agent_id.sql",
  "005_presence_entries_timestamp_defaults.sql",
];

function markApplied(db: ReturnType<typeof createDatabase>, names: readonly string[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const stmt = db.prepare("INSERT INTO _migrations (name) VALUES (?)");
  for (const name of names) {
    stmt.run(name);
  }
}

describe("SQLite migrations (upgrade compatibility)", () => {
  it("backfills baseline-only tables when 001_init.sql was applied before they existed", () => {
    const db = createDatabase(":memory:");
    markApplied(db, ["001_init.sql"]);

    db.exec(`
      -- Older databases have these core tables but may be missing newer baseline-only tables.
      CREATE TABLE watchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );

      CREATE TABLE capability_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capability_type TEXT NOT NULL,
        capability_identifier TEXT NOT NULL,
        executor_kind TEXT NOT NULL,
        selectors TEXT,
        outcome_metadata TEXT,
        cost_profile TEXT,
        anti_bot_notes TEXT,
        result_summary TEXT,
        success_count INTEGER NOT NULL DEFAULT 1,
        last_success_at TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        session_id TEXT NOT NULL PRIMARY KEY,
        channel TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        turns_json TEXT NOT NULL DEFAULT '[]',
        workspace_id TEXT NOT NULL DEFAULT 'default',
        compacted_summary TEXT DEFAULT '',
        compaction_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    migrate(db, migrationsDir);

    const expectedTables = [
      "artifact_metadata",
      "context_reports",
      "inbound_dedupe",
      "model_auth_profiles",
      "node_capabilities",
      "nodes",
      "outbound_idempotency",
      "policy_overrides",
      "policy_snapshots",
      "presence_entries",
      "watcher_firings",
    ] as const;

    for (const table of expectedTables) {
      const res = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .all(table) as Array<{ name: string }>;
      expect(res, `sqlite should have ${table}`).toHaveLength(1);
    }

    db.close();
  });

  it("preserves sessions compaction columns when present during 006_sessions_agent_id", () => {
    const db = createDatabase(":memory:");
    markApplied(db, MIGRATIONS_BEFORE_SESSIONS_AGENT_ID);

    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT NOT NULL PRIMARY KEY,
        channel TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        turns_json TEXT NOT NULL DEFAULT '[]',
        workspace_id TEXT NOT NULL DEFAULT 'default',
        compacted_summary TEXT DEFAULT '',
        compaction_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.prepare(
      `INSERT INTO sessions (
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         workspace_id,
         compacted_summary,
         compaction_count,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "s-1",
      "test",
      "thread-1",
      "summary",
      "[]",
      "default",
      "compacted",
      2,
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    );

    migrate(db, migrationsDir);

    const row = db.prepare(
      `SELECT agent_id, compacted_summary, compaction_count
       FROM sessions
       WHERE session_id = ? AND agent_id = ?`,
    ).get("s-1", "default") as { agent_id: string; compacted_summary: string; compaction_count: number };

    expect(row).toEqual({
      agent_id: "default",
      compacted_summary: "compacted",
      compaction_count: 2,
    });

    db.close();
  });

  it("backfills sessions compaction columns to defaults when missing during 006_sessions_agent_id", () => {
    const db = createDatabase(":memory:");
    markApplied(db, MIGRATIONS_BEFORE_SESSIONS_AGENT_ID);

    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT NOT NULL PRIMARY KEY,
        channel TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        turns_json TEXT NOT NULL DEFAULT '[]',
        workspace_id TEXT NOT NULL DEFAULT 'default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.prepare(
      `INSERT INTO sessions (
         session_id,
         channel,
         thread_id,
         summary,
         turns_json,
         workspace_id,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "s-2",
      "test",
      "thread-2",
      "summary",
      "[]",
      "default",
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
    );

    migrate(db, migrationsDir);

    const row = db.prepare(
      `SELECT agent_id, compacted_summary, compaction_count
       FROM sessions
       WHERE session_id = ? AND agent_id = ?`,
    ).get("s-2", "default") as { agent_id: string; compacted_summary: string; compaction_count: number };

    expect(row).toEqual({
      agent_id: "default",
      compacted_summary: "",
      compaction_count: 0,
    });

    db.close();
  });
});
