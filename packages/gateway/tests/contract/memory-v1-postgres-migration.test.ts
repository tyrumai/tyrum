import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { applyPostgresMigration, copyMigrationsBefore } from "./fk-audit-contract.test-support.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

async function getPostgresColumnUdtName(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  table: string,
  column: string,
): Promise<string | undefined> {
  const res = await client.query(
    `SELECT udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (res.rows[0] as { udt_name?: string } | undefined)?.udt_name;
}

describe("Memory v1 migrations (postgres)", () => {
  it("stores memory_tombstones.deleted_at as timestamptz", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await migratePostgres(pg, postgresMigrationsDir);
      const udt = await getPostgresColumnUdtName(pg, "memory_tombstones", "deleted_at");
      expect(udt).toBe("timestamptz");
    } finally {
      await pg.end();
    }
  });

  it("backfills auth token display names with pg-mem-compatible SQL", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    const pre126Dir = copyMigrationsBefore(postgresMigrationsDir, "126_");
    try {
      await migratePostgres(pg, pre126Dir);
      await pg.query(
        `INSERT INTO auth_tokens (
           token_id,
           tenant_id,
           role,
           device_id,
           scopes_json,
           secret_salt,
           secret_hash,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          "token-1",
          null,
          "client",
          "  operator-ui  ",
          "[]",
          "salt",
          "hash",
          "2026-02-01T00:00:00.000Z",
        ],
      );

      await applyPostgresMigration(
        pg,
        postgresMigrationsDir,
        "126_auth_tokens_display_name_updated_at.sql",
      );

      const result = await pg.query(
        "SELECT display_name, updated_at, created_at FROM auth_tokens WHERE token_id = $1",
        ["token-1"],
      );
      const row = result.rows[0] as
        | { created_at: string; display_name: string; updated_at: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.display_name).toBe("operator-ui");
      expect(row?.updated_at).toBe(row?.created_at);
    } finally {
      await pg.end();
    }
  });
});
