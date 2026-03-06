import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OutboxLifecycleScheduler } from "../../src/modules/backplane/outbox-lifecycle.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

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
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", cutoffOld],
    );
    await db.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", cutoffNew],
    );

    await db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "edge-old", 0, cutoffOld],
    );
    await db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "edge-new", 0, cutoffNew],
    );

    const scheduler = new OutboxLifecycleScheduler({
      db,
      retentionMs,
      clock: () => ({ nowIso: now.toISOString(), nowMs: now.getTime() }),
    });

    await scheduler.tick();

    const outboxRows = await db.all<{ created_at: string }>(
      "SELECT created_at FROM outbox WHERE tenant_id = ? ORDER BY id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(outboxRows).toEqual([{ created_at: cutoffNew }]);

    const consumerRows = await db.all<{ consumer_id: string }>(
      "SELECT consumer_id FROM outbox_consumers WHERE tenant_id = ? ORDER BY consumer_id ASC",
      [DEFAULT_TENANT_ID],
    );
    expect(consumerRows).toEqual([{ consumer_id: "edge-new" }]);
  });

  it("prunes multiple batches per tick when backlog exceeds batch size", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:10:00.000Z");
    const retentionMs = 5 * 60_000;
    const expiredAt = "2026-02-24T00:00:00.000Z";

    for (let i = 0; i < 3; i += 1) {
      await db.run(
        `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", expiredAt],
      );
    }

    const scheduler = new OutboxLifecycleScheduler({
      db,
      retentionMs,
      batchSize: 1,
      clock: () => ({ nowIso: now.toISOString(), nowMs: now.getTime() }),
    });

    await scheduler.tick();

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM outbox WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(outboxCount?.count).toBe(0);
  });

  it("records prune metrics for outbox compaction", async () => {
    db = openTestSqliteDb();

    const now = new Date("2026-02-24T00:10:00.000Z");
    const retentionMs = 5 * 60_000;
    const cutoffOld = "2026-02-24T00:04:59.000Z";
    const metrics = new MetricsRegistry();

    await db.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ws.broadcast", null, "{}", cutoffOld],
    );
    await db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "edge-old", 0, cutoffOld],
    );

    const scheduler = new OutboxLifecycleScheduler({
      db,
      metrics,
      retentionMs,
      clock: () => ({ nowIso: now.toISOString(), nowMs: now.getTime() }),
    });

    await scheduler.tick();

    const lifecycleMetrics = await metrics.registry.getSingleMetricAsString(
      "lifecycle_prune_rows_total",
    );
    expect(lifecycleMetrics).toContain('scheduler="outbox",table="outbox"');
    expect(lifecycleMetrics).toContain('scheduler="outbox",table="outbox_consumers"');
  });
});
