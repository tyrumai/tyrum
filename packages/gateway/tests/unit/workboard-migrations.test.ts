import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
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

  it("applies the workboard persistence migration", async () => {
    const db = openDb();
    const migration = await db.get<{ name: string }>(
      "SELECT name FROM _migrations WHERE name = ?",
      ["026_workboard_persistence.sql"],
    );
    expect(migration?.name).toBe("026_workboard_persistence.sql");
  });

  it("creates workboard tables", async () => {
    const db = openDb();
    const tables = [
      "work_items",
      "work_item_tasks",
      "work_item_events",
      "work_item_links",
      "work_artifacts",
      "work_decisions",
      "work_signals",
      "work_item_state_kv",
      "agent_state_kv",
      "subagents",
      "work_scope_activity",
    ];

    for (const table of tables) {
      const row = await db.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      expect(row?.name).toBe(table);
    }
  });
});
