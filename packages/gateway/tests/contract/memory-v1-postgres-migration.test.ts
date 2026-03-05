import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migratePostgres } from "../../src/migrate-postgres.js";
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
});
