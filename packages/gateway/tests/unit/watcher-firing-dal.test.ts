import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WatcherFiringDal } from "../../src/modules/watcher/firing-dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import mitt from "mitt";
import type { GatewayEvents } from "../../src/event-bus.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("WatcherFiringDal", () => {
  let db: SqliteDb;
  let dal: WatcherFiringDal;
  let processor: WatcherProcessor;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new WatcherFiringDal(db);
    processor = new WatcherProcessor({
      db,
      memoryV1Dal: new MemoryV1Dal(db),
      eventBus: mitt<GatewayEvents>(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("dedupes firings by watcher+slot", async () => {
    const watcherId = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const firing1 = randomUUID();
    const firing2 = randomUUID();

    const first = await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firing1,
      watcherId,
      scheduledAtMs: 1000,
    });
    expect(first.created).toBe(true);
    expect(first.row.watcher_firing_id).toBe(firing1);

    const second = await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firing2,
      watcherId,
      scheduledAtMs: 1000,
    });
    expect(second.created).toBe(false);
    expect(second.row.watcher_firing_id).toBe(firing1);
  });

  it("dedupes firings by firing_id", async () => {
    const watcherId = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const firingId = randomUUID();

    const first = await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId,
      scheduledAtMs: 1000,
    });
    expect(first.created).toBe(true);

    const second = await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId,
      scheduledAtMs: 2000,
    });
    expect(second.created).toBe(false);
    expect(second.row.watcher_firing_id).toBe(firingId);
    expect(second.row.scheduled_at_ms).toBe(1000);
  });

  it("throws when firing_id exists with different attributes", async () => {
    const watcherA = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const watcherB = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const firingId = randomUUID();

    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId: watcherA,
      scheduledAtMs: 1000,
    });

    await expect(
      dal.createIfAbsent({
        tenantId: DEFAULT_TENANT_ID,
        watcherFiringId: firingId,
        watcherId: watcherB,
        scheduledAtMs: 1000,
      }),
    ).rejects.toThrow(/different attributes|another watcher/i);
  });

  it("claims queued firings in schedule order", async () => {
    const watcherA = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const watcherB = await processor.createWatcher("plan-2", "periodic", { intervalMs: 1000 });
    const firingA = randomUUID();
    const firingB = randomUUID();

    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingA,
      watcherId: watcherA,
      scheduledAtMs: 1000,
    });
    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingB,
      watcherId: watcherB,
      scheduledAtMs: 2000,
    });

    const first = await dal.claimNext({ owner: "a", nowMs: 1500, leaseTtlMs: 10_000 });
    expect(first?.watcher_firing_id).toBe(firingA);
    expect(first?.status).toBe("processing");
    expect(first?.lease_owner).toBe("a");

    const second = await dal.claimNext({ owner: "b", nowMs: 1500, leaseTtlMs: 10_000 });
    expect(second?.watcher_firing_id).toBe(firingB);
    expect(second?.lease_owner).toBe("b");
  });

  it("allows lease takeover after expiry", async () => {
    const watcherId = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const firingId = randomUUID();
    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId,
      scheduledAtMs: 1000,
    });

    const claimed = await dal.claimNext({ owner: "a", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(claimed?.lease_owner).toBe("a");

    // Force expiry.
    await db.run(
      "UPDATE watcher_firings SET lease_expires_at_ms = ? WHERE tenant_id = ? AND watcher_firing_id = ?",
      [500, DEFAULT_TENANT_ID, firingId],
    );

    const taken = await dal.claimNext({ owner: "b", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(taken?.watcher_firing_id).toBe(firingId);
    expect(taken?.lease_owner).toBe("b");
    expect(taken?.attempt).toBeGreaterThanOrEqual(2);
  });

  it("marks enqueued only for current owner", async () => {
    const watcherId = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    const firingId = randomUUID();
    await dal.createIfAbsent({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      watcherId,
      scheduledAtMs: 1000,
    });
    const claimed = await dal.claimNext({ owner: "a", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(claimed?.lease_owner).toBe("a");

    const wrongOwner = await dal.markEnqueued({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      owner: "b",
    });
    expect(wrongOwner).toBe(false);

    const jobId = randomUUID();
    const runId = randomUUID();
    await db.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "agent:default:main",
        "cron",
        "{}",
      ],
    );
    await db.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, 'queued', 1)`,
      [DEFAULT_TENANT_ID, runId, jobId, "agent:default:main", "cron"],
    );

    const ok = await dal.markEnqueued({
      tenantId: DEFAULT_TENANT_ID,
      watcherFiringId: firingId,
      owner: "a",
      jobId,
      runId,
    });
    expect(ok).toBe(true);

    const row = await dal.getById({ tenantId: DEFAULT_TENANT_ID, watcherFiringId: firingId });
    expect(row?.status).toBe("enqueued");
    expect(row?.job_id).toBe(jobId);
    expect(row?.run_id).toBe(runId);
  });
});
