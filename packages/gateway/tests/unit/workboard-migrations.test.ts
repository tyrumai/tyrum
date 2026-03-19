import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("WorkBoard migrations", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function openDb(): SqliteDb {
    db = openTestSqliteDb();
    return db;
  }

  it("applies the v2 rebuild migration", async () => {
    const sqliteDb = openDb();
    const migration = await sqliteDb.get<{ name: string }>(
      "SELECT name FROM _migrations WHERE name = ?",
      ["100_rebuild_v2.sql"],
    );
    expect(migration?.name).toBe("100_rebuild_v2.sql");
  });

  it("creates workboard tables", async () => {
    const sqliteDb = openDb();
    const tables = [
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
    ];

    for (const table of tables) {
      const row = await sqliteDb.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      expect(row?.name).toBe(table);
    }
  });

  it("drops execution tables child-first in rebuild migration", () => {
    const sql = readFileSync(join(SQLITE_MIGRATIONS_DIR, "100_rebuild_v2.sql"), "utf-8");

    const dropOrder = Array.from(
      sql.matchAll(/^DROP TABLE IF EXISTS ([a-z0-9_]+);$/gim),
      (match) => match[1],
    );

    const indexOfDrop = (tableName: string): number => dropOrder.indexOf(tableName);

    expect(indexOfDrop("artifact_links")).toBeLessThan(indexOfDrop("artifact_access"));
    expect(indexOfDrop("artifact_access")).toBeLessThan(indexOfDrop("artifacts"));
    expect(indexOfDrop("artifacts")).toBeLessThan(indexOfDrop("execution_attempts"));
    expect(indexOfDrop("execution_attempts")).toBeLessThan(indexOfDrop("execution_steps"));
    expect(indexOfDrop("resume_tokens")).toBeLessThan(indexOfDrop("execution_runs"));
    expect(indexOfDrop("execution_steps")).toBeLessThan(indexOfDrop("execution_runs"));
    expect(indexOfDrop("execution_runs")).toBeLessThan(indexOfDrop("execution_jobs"));
  });
});
