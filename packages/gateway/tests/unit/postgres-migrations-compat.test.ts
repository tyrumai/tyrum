import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { migratePostgres } from "../../src/migrate-postgres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/postgres");

describe("Postgres migrations (upgrade compatibility)", () => {
  it("backfills baseline-only tables when 001_init.sql was applied before they existed", async () => {
    // This test needs to simulate `_migrations` already existing, which makes
    // migratePostgres run `CREATE TABLE IF NOT EXISTS _migrations (...)` as a
    // no-op. pg-mem can throw on such no-op DDL unless AST coverage checks are
    // disabled.
    const mem = newDb({ noAstCoverageCheck: true });
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();

    try {
      await pg.query(`
        CREATE TABLE _migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        INSERT INTO _migrations (name) VALUES ('001_init.sql');

        -- Older databases have these core tables but may be missing newer baseline-only tables.
        CREATE TABLE watchers (
          id SERIAL PRIMARY KEY
        );

        CREATE TABLE capability_memories (
          id SERIAL PRIMARY KEY,
          capability_type TEXT NOT NULL,
          capability_identifier TEXT NOT NULL,
          executor_kind TEXT NOT NULL
        );

        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          channel TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          turns_json TEXT NOT NULL DEFAULT '[]',
          workspace_id TEXT NOT NULL DEFAULT 'default',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await expect(migratePostgres(pg, migrationsDir)).resolves.toBeUndefined();

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
        const res = await pg.query(
          `SELECT 1
           FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        expect(res.rows, `postgres should have ${table}`).toHaveLength(1);
      }
    } finally {
      await pg.end();
    }
  });
});
