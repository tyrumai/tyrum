import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { getPostgresColumns, getSqliteColumns } from "../helpers/schema-introspection.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteRebuildPath = join(__dirname, "../../migrations/sqlite/100_rebuild_v2.sql");
const postgresRebuildPath = join(__dirname, "../../migrations/postgres/100_rebuild_v2.sql");

describe("Migration naming hygiene", () => {
  it("keeps vector_metadata PK column name aligned in rebuild v2", async () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec(readFileSync(sqliteRebuildPath, "utf-8"));
      const columns = getSqliteColumns(sqlite, "vector_metadata");
      expect(columns).toContain("vector_metadata_id");
      expect(columns).not.toContain("id");
    } finally {
      sqlite.close();
    }

    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await pg.query(readFileSync(postgresRebuildPath, "utf-8"));
      const columns = await getPostgresColumns(pg, "vector_metadata");
      expect(columns).toContain("vector_metadata_id");
      expect(columns).not.toContain("id");
    } finally {
      await pg.end();
    }
  });
});
