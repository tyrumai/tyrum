import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { exportSnapshot } from "../../src/modules/snapshot/export.js";
import { importSnapshot } from "../../src/modules/snapshot/import.js";
import { createSnapshotRoutes } from "../../src/routes/snapshot.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqlDb } from "../../src/statestore/types.js";
import type { SnapshotBundle } from "../../src/modules/snapshot/export.js";

describe("snapshot import", () => {
  let db: SqlDb;

  beforeEach(async () => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("round-trips data through export and import", async () => {
    await db.run(
      `INSERT INTO sessions (session_id, channel, thread_id) VALUES (?, ?, ?)`,
      ["sess-rt", "test-channel", "thread-rt"],
    );

    const exported = await exportSnapshot(db);
    const sessions1 = exported.tables["sessions"] as Record<string, unknown>[];
    expect(sessions1).toHaveLength(1);

    // Import into the same DB (which clears then re-inserts)
    const result = await importSnapshot(db, exported);
    expect(result.tables_imported).toBeGreaterThanOrEqual(1);
    expect(result.rows_imported).toBeGreaterThanOrEqual(1);

    // Export again and compare
    const reExported = await exportSnapshot(db);
    expect(reExported.tables["sessions"]).toEqual(exported.tables["sessions"]);
  });

  it("succeeds with empty tables", async () => {
    const bundle: SnapshotBundle = {
      version: 1,
      exported_at: new Date().toISOString(),
      db_kind: "sqlite",
      tables: {},
    };

    const result = await importSnapshot(db, bundle);
    expect(result.tables_imported).toBe(0);
    expect(result.rows_imported).toBe(0);
  });

  it("rejects version !== 1", async () => {
    const bundle = {
      version: 2,
      exported_at: new Date().toISOString(),
      db_kind: "sqlite",
      tables: {},
    } as unknown as SnapshotBundle;

    await expect(importSnapshot(db, bundle)).rejects.toThrow(
      "Unsupported snapshot version: 2",
    );
  });

  it("rejects unknown table names", async () => {
    const bundle: SnapshotBundle = {
      version: 1,
      exported_at: new Date().toISOString(),
      db_kind: "sqlite",
      tables: { bogus_table: [{ id: 1 }] },
    };

    await expect(importSnapshot(db, bundle)).rejects.toThrow(
      "Unknown table in snapshot bundle: bogus_table",
    );
  });

  describe("route", () => {
    it("rejects without confirm flag", async () => {
      const app = new Hono();
      app.route("/", createSnapshotRoutes({ db }));

      const res = await app.request("/snapshot/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, tables: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body["error"]).toBe("confirmation_required");
    });
  });
});
