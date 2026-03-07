import { describe, expect, it } from "vitest";
import { createDatabase } from "../../src/db.js";
import { newDb } from "pg-mem";
import { PostgresDb } from "../../src/statestore/postgres.js";
import { sqlActiveWhereClause, sqlBoolParam } from "../../src/statestore/sql.js";

describe("statestore SQL helpers", () => {
  it("maps boolean parameters per dialect", () => {
    expect(sqlBoolParam({ kind: "sqlite" }, true)).toBe(1);
    expect(sqlBoolParam({ kind: "sqlite" }, false)).toBe(0);
    expect(sqlBoolParam({ kind: "postgres" }, true)).toBe(true);
    expect(sqlBoolParam({ kind: "postgres" }, false)).toBe(false);
  });

  it("produces active clause that runs on sqlite and postgres", async () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec("CREATE TABLE watchers (active INTEGER NOT NULL CHECK (active IN (0, 1)))");
      sqlite.exec("INSERT INTO watchers (active) VALUES (1), (0)");

      const sqliteClause = sqlActiveWhereClause({ kind: "sqlite" });
      const sqliteRows = sqlite
        .prepare(`SELECT active FROM watchers WHERE ${sqliteClause.sql}`)
        .all(...sqliteClause.params);
      expect(sqliteRows).toEqual([{ active: 1 }]);
    } finally {
      sqlite.close();
    }

    const mem = newDb();
    const { Client } = mem.adapters.createPg();
    const client = new Client();
    await client.connect();
    try {
      const DbCtor = PostgresDb as unknown as new (opts: { client: typeof client }) => PostgresDb;
      const postgres = new DbCtor({ client });
      await postgres.exec("CREATE TABLE watchers (active BOOLEAN NOT NULL)");
      await postgres.run("INSERT INTO watchers (active) VALUES (?), (?)", [true, false]);

      const pgClause = sqlActiveWhereClause(postgres);
      const pgRows = await postgres.all<{ active: boolean }>(
        `SELECT active FROM watchers WHERE ${pgClause.sql}`,
        pgClause.params,
      );
      expect(pgRows).toEqual([{ active: true }]);
    } finally {
      await client.end();
    }
  });

  it("supports an explicit column reference for aliased queries", () => {
    const clause = sqlActiveWhereClause({ kind: "sqlite" }, { column: "w.active" });

    expect(clause).toEqual({
      sql: "w.active = ?",
      params: [1],
    });
  });
});
