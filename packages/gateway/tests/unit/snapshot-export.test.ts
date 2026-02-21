import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exportSnapshot, getExportedTableNames } from "../../src/modules/snapshot/export.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("snapshot export", () => {
  let db: SqlDb;

  beforeEach(async () => {
    db = await openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("exports a bundle with version and timestamp", async () => {
    const bundle = await exportSnapshot(db);

    expect(bundle.version).toBe(1);
    expect(bundle.exported_at).toBeDefined();
    expect(bundle.db_kind).toBe("sqlite");
    expect(typeof bundle.tables).toBe("object");
  });

  it("includes all durable table keys", async () => {
    const bundle = await exportSnapshot(db);
    const expectedTables = getExportedTableNames();

    for (const table of expectedTables) {
      expect(bundle.tables).toHaveProperty(table);
      expect(Array.isArray(bundle.tables[table])).toBe(true);
    }
  });

  it("exports data that was inserted", async () => {
    await db.run(
      `INSERT INTO sessions (session_id, channel, thread_id)
       VALUES (?, ?, ?)`,
      ["sess-1", "test-channel", "thread-1"],
    );

    const bundle = await exportSnapshot(db);
    const sessions = bundle.tables["sessions"] as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!["session_id"]).toBe("sess-1");
  });

  it("returns empty arrays for tables with no data", async () => {
    const bundle = await exportSnapshot(db);

    // All tables should be empty in a fresh DB
    for (const rows of Object.values(bundle.tables)) {
      expect(rows).toHaveLength(0);
    }
  });

  it("export is consistent (transactional)", async () => {
    await db.run(
      `INSERT INTO sessions (session_id, channel, thread_id)
       VALUES (?, ?, ?)`,
      ["sess-tx", "test-channel", "thread-1"],
    );

    const bundle = await exportSnapshot(db);
    expect(bundle.version).toBe(1);
    expect((bundle.tables["sessions"] as unknown[]).length).toBeGreaterThan(0);
  });
});
