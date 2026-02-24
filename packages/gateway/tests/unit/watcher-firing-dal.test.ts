import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WatcherFiringDal } from "../../src/modules/watcher/firing-dal.js";

describe("WatcherFiringDal", () => {
  let db: SqliteDb;
  let dal: WatcherFiringDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new WatcherFiringDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("dedupes firings by watcher+slot", async () => {
    const first = await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });
    expect(first.created).toBe(true);
    expect(first.row.firing_id).toBe("firing-1");

    const second = await dal.createIfAbsent({
      firingId: "firing-2",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });
    expect(second.created).toBe(false);
    expect(second.row.firing_id).toBe("firing-1");
  });

  it("dedupes firings by firing_id", async () => {
    const first = await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });
    expect(first.created).toBe(true);

    const second = await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 2000,
    });
    expect(second.created).toBe(false);
    expect(second.row.firing_id).toBe("firing-1");
    expect(second.row.scheduled_at_ms).toBe(1000);
  });

  it("throws on unexpected unique constraint violations", async () => {
    await db.run("CREATE UNIQUE INDEX watcher_firings_plan_id_unique_idx ON watcher_firings (plan_id)");

    await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });

    await expect(
      dal.createIfAbsent({
        firingId: "firing-2",
        watcherId: 1,
        planId: "plan-1",
        triggerType: "periodic",
        scheduledAtMs: 2000,
      }),
    ).rejects.toThrow(/plan_id/i);
  });

  it("throws when firing_id exists with different attributes", async () => {
    await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });

    await expect(
      dal.createIfAbsent({
        firingId: "firing-1",
        watcherId: 2,
        planId: "plan-1",
        triggerType: "periodic",
        scheduledAtMs: 1000,
      }),
    ).rejects.toThrow(/different attributes/i);
  });

  it("claims queued firings in schedule order", async () => {
    await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });
    await dal.createIfAbsent({
      firingId: "firing-2",
      watcherId: 2,
      planId: "plan-2",
      triggerType: "periodic",
      scheduledAtMs: 2000,
    });

    const first = await dal.claimNext({ owner: "a", nowMs: 1500, leaseTtlMs: 10_000 });
    expect(first?.firing_id).toBe("firing-1");
    expect(first?.status).toBe("processing");
    expect(first?.lease_owner).toBe("a");

    const second = await dal.claimNext({ owner: "b", nowMs: 1500, leaseTtlMs: 10_000 });
    expect(second?.firing_id).toBe("firing-2");
    expect(second?.lease_owner).toBe("b");
  });

  it("allows lease takeover after expiry", async () => {
    await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });

    const claimed = await dal.claimNext({ owner: "a", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(claimed?.lease_owner).toBe("a");

    // Force expiry.
    await db.run(
      "UPDATE watcher_firings SET lease_expires_at_ms = ? WHERE firing_id = ?",
      [500, "firing-1"],
    );

    const taken = await dal.claimNext({ owner: "b", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(taken?.firing_id).toBe("firing-1");
    expect(taken?.lease_owner).toBe("b");
    expect(taken?.attempt).toBeGreaterThanOrEqual(2);
  });

  it("marks enqueued only for current owner", async () => {
    await dal.createIfAbsent({
      firingId: "firing-1",
      watcherId: 1,
      planId: "plan-1",
      triggerType: "periodic",
      scheduledAtMs: 1000,
    });
    const claimed = await dal.claimNext({ owner: "a", nowMs: 1000, leaseTtlMs: 10_000 });
    expect(claimed?.lease_owner).toBe("a");

    const wrongOwner = await dal.markEnqueued({ firingId: "firing-1", owner: "b" });
    expect(wrongOwner).toBe(false);

    const ok = await dal.markEnqueued({ firingId: "firing-1", owner: "a", jobId: "job-1", runId: "run-1" });
    expect(ok).toBe(true);

    const row = await dal.getById("firing-1");
    expect(row?.status).toBe("enqueued");
    expect(row?.job_id).toBe("job-1");
    expect(row?.run_id).toBe("run-1");
  });
});
