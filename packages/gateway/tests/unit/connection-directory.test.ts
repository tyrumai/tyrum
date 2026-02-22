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
});
