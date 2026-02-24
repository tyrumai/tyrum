import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OutboxLifecycleScheduler } from "../../src/modules/backplane/outbox-lifecycle.js";

describe("OutboxLifecycleScheduler", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("prunes outbox rows and consumers older than the retention window", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:10:00.000Z");
    const retentionMs = 5 * 60_000;
    const cutoffOld = "2026-02-24T00:04:59.000Z";
    const cutoffNew = "2026-02-24T00:05:01.000Z";

    await db.run(
      `INSERT INTO outbox (topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)`,
      ["ws.broadcast", null, "{}", cutoffOld],
    );
    await db.run(
      `INSERT INTO outbox (topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)`,
      ["ws.broadcast", null, "{}", cutoffNew],
    );

    await db.run(
      `INSERT INTO outbox_consumers (consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?)`,
      ["edge-old", 0, cutoffOld],
    );
    await db.run(
      `INSERT INTO outbox_consumers (consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?)`,
      ["edge-new", 0, cutoffNew],
    );

    const scheduler = new OutboxLifecycleScheduler({
      db,
      retentionMs,
      clock: () => ({ nowIso: now.toISOString(), nowMs: now.getTime() }),
    });

    await scheduler.tick();

    const outboxRows = await db.all<{ created_at: string }>(
      "SELECT created_at FROM outbox ORDER BY id ASC",
    );
    expect(outboxRows).toEqual([{ created_at: cutoffNew }]);

    const consumerRows = await db.all<{ consumer_id: string }>(
      "SELECT consumer_id FROM outbox_consumers ORDER BY consumer_id ASC",
    );
    expect(consumerRows).toEqual([{ consumer_id: "edge-new" }]);
  });
});

