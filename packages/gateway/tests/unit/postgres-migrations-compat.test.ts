import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { migratePostgres } from "../../src/migrate-postgres.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/postgres");

describe("Postgres migrations (upgrade compatibility)", () => {
  it("applies incremental migrations on top of the 001_init.sql baseline", async () => {
    // This test needs to simulate `_migrations` already existing, which makes
    // migratePostgres run `CREATE TABLE IF NOT EXISTS _migrations (...)` as a
    // no-op. pg-mem can throw on such no-op DDL unless AST coverage checks are
    // disabled.
    const mem = newDb({ noAstCoverageCheck: true });
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();

    try {
      await pg.query(readFileSync(join(migrationsDir, "001_init.sql"), "utf-8"));
      await pg.query(`
        CREATE TABLE _migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        INSERT INTO _migrations (name) VALUES ('001_init.sql');
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
