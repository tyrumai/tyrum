import { afterEach, describe, expect, it } from "vitest";
import { ConnectionDirectoryDal } from "../../src/modules/backplane/connection-directory.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("ConnectionDirectoryDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function setup(): ConnectionDirectoryDal {
    db = openTestSqliteDb();
    return new ConnectionDirectoryDal(db);
  }

  it("upserts, filters by capability, and expires connections", async () => {
    const dir = setup();
    const now = 1_000_000;

    await dir.upsertConnection({
      connectionId: "c1",
      edgeId: "edge-a",
      role: "client",
      capabilities: ["playwright"],
      nowMs: now,
      ttlMs: 5_000,
    });

    expect(await dir.listConnectionsForCapability("playwright", now)).toHaveLength(1);
    expect(await dir.listConnectionsForCapability("cli", now)).toHaveLength(0);

    // Expire it
    expect(await dir.cleanupExpired(now + 10_000)).toBe(1);
    expect(await dir.listConnectionsForCapability("playwright", now + 10_000)).toHaveLength(0);
  });

  it("treats missing readiness as ready=capabilities (rolling upgrade safe)", async () => {
    const dir = setup();
    const now = 1_000_000;

    // Simulate an older edge writing a directory row that does not set readiness.
    await db!.run(
      `INSERT INTO connection_directory (
         connection_id,
         edge_id,
         role,
         protocol_rev,
         device_id,
         capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["c-node-1", "edge-a", "node", 2, "dev_test", JSON.stringify(["cli"]), now, now, now + 5_000],
    );

    const rows = await dir.listNonExpired(now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capabilities).toEqual(["cli"]);
    expect(rows[0]!.ready_capabilities).toEqual(["cli"]);
  });

  it("treats malformed readiness as ready=capabilities (rolling upgrade safe)", async () => {
    const dir = setup();
    const now = 1_000_000;

    // Simulate a corrupted readiness payload; should fall back to advertised capabilities.
    await db!.run(
      `INSERT INTO connection_directory (
         connection_id,
         edge_id,
         role,
         protocol_rev,
         device_id,
         capabilities_json,
         ready_capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "c-node-1",
        "edge-a",
        "node",
        2,
        "dev_test",
        JSON.stringify(["cli"]),
        "{ not valid json",
        now,
        now,
        now + 5_000,
      ],
    );

    const rows = await dir.listNonExpired(now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capabilities).toEqual(["cli"]);
    expect(rows[0]!.ready_capabilities).toEqual(["cli"]);
  });
});
