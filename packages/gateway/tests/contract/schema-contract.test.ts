import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { migrate } from "../../src/migrate.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

function getSqliteColumns(db: ReturnType<typeof createDatabase>, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

async function getPostgresColumns(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, table: string): Promise<string[]> {
  const res = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return (res.rows as Array<{ column_name: string }>).map((r) => r.column_name);
}

describe("StateStore schema contract (sqlite vs postgres)", () => {
  it("keeps core table column sets aligned", async () => {
    // SQLite (real engine)
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    // Postgres (pg-mem, node-postgres adapter)
    const mem = newDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await migratePostgres(pg, postgresMigrationsDir);

      const tables = [
        "planner_events",
        "facts",
        "episodic_events",
        "vector_metadata",
        "capability_memories",
        "pam_profiles",
        "pvp_profiles",
        "watchers",
        "watcher_firings",
        "sessions",
        "approvals",
        "jobs",
        "canvas_artifacts",
        "outbox",
        "outbox_consumers",
        "connection_directory",
        "presence_entries",
        "node_pairings",
        "policy_snapshots",
        "policy_overrides",
        "auth_profiles",
        "session_provider_pins",
        "context_reports",
        "secret_resolutions",
        "execution_jobs",
        "execution_runs",
        "execution_steps",
        "execution_attempts",
        "execution_artifacts",
        "channel_inbox",
        "channel_outbox",
        "concurrency_slots",
        "lane_leases",
        "idempotency_records",
        "resume_tokens",
      ] as const;

      for (const table of tables) {
        const sqliteCols = getSqliteColumns(sqlite, table).sort();
        const pgCols = (await getPostgresColumns(pg, table)).sort();
        expect(pgCols, `postgres columns for ${table}`).toEqual(sqliteCols);
      }
    } finally {
      await pg.end();
      sqlite.close();
    }
  });
});
