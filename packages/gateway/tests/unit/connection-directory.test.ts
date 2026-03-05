import { afterEach, describe, expect, it } from "vitest";
import { ConnectionDirectoryDal } from "../../src/modules/backplane/connection-directory.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
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
      connectionId: "00000000-0000-4000-8000-000000000011",
      edgeId: "edge-a",
      role: "client",
      capabilities: ["playwright"],
      nowMs: now,
      ttlMs: 5_000,
    });

    expect(
      await dir.listConnectionsForCapability(DEFAULT_TENANT_ID, "playwright", now),
    ).toHaveLength(1);
    expect(await dir.listConnectionsForCapability(DEFAULT_TENANT_ID, "cli", now)).toHaveLength(0);

    // Expire it
    expect(await dir.cleanupExpired(now + 10_000)).toBe(1);
    expect(
      await dir.listConnectionsForCapability(DEFAULT_TENANT_ID, "playwright", now + 10_000),
    ).toHaveLength(0);
  });

  it("treats missing readiness as ready=capabilities (rolling upgrade safe)", async () => {
    const dir = setup();
    const now = 1_000_000;

    // Simulate an older edge writing a directory row that does not set readiness.
    await db!.run(
      `INSERT INTO principals (
         tenant_id,
         principal_id,
         kind,
         principal_key,
         status,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000021",
        "node",
        "dev_test",
        "active",
        "{}",
      ],
    );
    await db!.run(
      `INSERT INTO connections (
         tenant_id,
         connection_id,
         edge_id,
         principal_id,
         capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000022",
        "edge-a",
        "00000000-0000-4000-8000-000000000021",
        JSON.stringify(["cli"]),
        now,
        now,
        now + 5_000,
      ],
    );

    const rows = await dir.listNonExpired(DEFAULT_TENANT_ID, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capabilities).toEqual(["cli"]);
    expect(rows[0]!.ready_capabilities).toEqual(["cli"]);
  });

  it("treats malformed readiness as ready=capabilities (rolling upgrade safe)", async () => {
    const dir = setup();
    const now = 1_000_000;

    // Simulate a corrupted readiness payload; should fall back to advertised capabilities.
    await db!.run(
      `INSERT INTO principals (
         tenant_id,
         principal_id,
         kind,
         principal_key,
         status,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000031",
        "node",
        "dev_test",
        "active",
        "{}",
      ],
    );

    await db!.run(
      `INSERT INTO connections (
         tenant_id,
         connection_id,
         edge_id,
         principal_id,
         protocol_rev,
         capabilities_json,
         ready_capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000032",
        "edge-a",
        "00000000-0000-4000-8000-000000000031",
        2,
        JSON.stringify(["cli"]),
        "{ not valid json",
        now,
        now,
        now + 5_000,
      ],
    );

    const rows = await dir.listNonExpired(DEFAULT_TENANT_ID, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.capabilities).toEqual(["cli"]);
    expect(rows[0]!.ready_capabilities).toEqual(["cli"]);
  });
});
