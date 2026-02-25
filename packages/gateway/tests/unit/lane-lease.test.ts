import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { releaseLaneLease } from "../../src/modules/lanes/lane-lease.js";

describe("releaseLaneLease", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("clears lane_queue_signals when a lease is released", async () => {
    await db.run(
      `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      ["key-1", "main", "worker-1", 60_000],
    );
    await db.run(
      `INSERT INTO lane_queue_signals (key, lane, kind, inbox_id, queue_mode, message_text, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["key-1", "main", "interrupt", 1, "interrupt", "stop", 1_000],
    );

    await releaseLaneLease(db, { key: "key-1", lane: "main", owner: "worker-1" });

    const lease = await db.get<{ key: string }>(
      "SELECT key FROM lane_leases WHERE key = ? AND lane = ?",
      ["key-1", "main"],
    );
    expect(lease).toBeUndefined();

    const signal = await db.get<{ key: string }>(
      "SELECT key FROM lane_queue_signals WHERE key = ? AND lane = ?",
      ["key-1", "main"],
    );
    expect(signal).toBeUndefined();
  });

  it("preserves lane_queue_signals when the lease owner does not match", async () => {
    await db.run(
      `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      ["key-1", "main", "worker-1", 60_000],
    );
    await db.run(
      `INSERT INTO lane_queue_signals (key, lane, kind, inbox_id, queue_mode, message_text, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["key-1", "main", "interrupt", 1, "interrupt", "stop", 1_000],
    );

    await releaseLaneLease(db, { key: "key-1", lane: "main", owner: "worker-2" });

    const lease = await db.get<{ key: string }>(
      "SELECT key FROM lane_leases WHERE key = ? AND lane = ?",
      ["key-1", "main"],
    );
    expect(lease?.key).toBe("key-1");

    const signal = await db.get<{ key: string }>(
      "SELECT key FROM lane_queue_signals WHERE key = ? AND lane = ?",
      ["key-1", "main"],
    );
    expect(signal?.key).toBe("key-1");
  });
});
