import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { WorkSignalFiringDal } from "../../src/modules/workboard/signal-firing-dal.js";

describe("WorkSignalFiringDal", () => {
  it("creates firings idempotently (deduped per signal + key)", async () => {
    const db = openTestSqliteDb();
    try {
      const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
      const workboardDal = new WorkboardDal(db);
      const signal = await workboardDal.createSignal({
        scope,
        signal: {
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition" },
        },
      });

      const dal = new WorkSignalFiringDal(db);

      const first = await dal.createIfAbsent({
        firingId: "firing-1",
        signalId: signal.signal_id,
        dedupeKey: "dedupe-1",
      });
      expect(first.created).toBe(true);
      expect(first.row.firing_id).toBe("firing-1");

      const second = await dal.createIfAbsent({
        firingId: "firing-1",
        signalId: signal.signal_id,
        dedupeKey: "dedupe-1",
      });
      expect(second.created).toBe(false);
      expect(second.row.firing_id).toBe("firing-1");

      const deduped = await dal.createIfAbsent({
        firingId: "firing-2",
        signalId: signal.signal_id,
        dedupeKey: "dedupe-1",
      });
      expect(deduped.created).toBe(false);
      expect(deduped.row.firing_id).toBe("firing-1");
    } finally {
      await db.close();
    }
  });

  it("claims queued and expired processing firings with leases", async () => {
    const db = openTestSqliteDb();
    try {
      const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
      const workboardDal = new WorkboardDal(db);
      const signal = await workboardDal.createSignal({
        scope,
        signal: {
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition" },
        },
      });

      const dal = new WorkSignalFiringDal(db);
      await dal.createIfAbsent({
        firingId: "firing-1",
        signalId: signal.signal_id,
        dedupeKey: "k1",
      });

      const claimedA = await dal.claimNext({ owner: "a", nowMs: 1_000, leaseTtlMs: 10 });
      expect(claimedA?.status).toBe("processing");
      expect(claimedA?.lease_owner).toBe("a");
      expect(claimedA?.lease_expires_at_ms).toBe(1_010);
      expect(claimedA?.attempt).toBe(1);

      const claimedB = await dal.claimNext({ owner: "b", nowMs: 1_000, leaseTtlMs: 10 });
      expect(claimedB).toBeUndefined();

      const reclaimed = await dal.claimNext({ owner: "b", nowMs: 1_011, leaseTtlMs: 10 });
      expect(reclaimed?.status).toBe("processing");
      expect(reclaimed?.lease_owner).toBe("b");
      expect(reclaimed?.lease_expires_at_ms).toBe(1_021);
      expect(reclaimed?.attempt).toBe(2);
    } finally {
      await db.close();
    }
  });

  it("backs off retryable failures and marks max-attempt failures", async () => {
    const db = openTestSqliteDb();
    try {
      const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
      const workboardDal = new WorkboardDal(db);
      const signal = await workboardDal.createSignal({
        scope,
        signal: {
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition" },
        },
      });

      const dal = new WorkSignalFiringDal(db);
      await dal.createIfAbsent({
        firingId: "firing-1",
        signalId: signal.signal_id,
        dedupeKey: "k1",
      });

      await dal.claimNext({ owner: "a", nowMs: 1_000, leaseTtlMs: 10 });
      await dal.markRetryableFailure({
        firingId: "firing-1",
        owner: "a",
        nowMs: 2_000,
        maxAttempts: 5,
        error: "boom",
      });

      const queued = await dal.getById("firing-1");
      expect(queued?.status).toBe("queued");
      expect(queued?.lease_owner).toBeNull();
      expect(queued?.next_attempt_at_ms).toBe(3_000);
      expect(queued?.error).toBe("boom");

      await dal.claimNext({ owner: "a", nowMs: 3_000, leaseTtlMs: 10 });
      await dal.markRetryableFailure({
        firingId: "firing-1",
        owner: "a",
        nowMs: 3_000,
        maxAttempts: 1,
        error: "still boom",
      });

      const failed = await dal.getById("firing-1");
      expect(failed?.status).toBe("failed");
      expect(failed?.lease_owner).toBeNull();
      expect(failed?.error).toBe("still boom");
    } finally {
      await db.close();
    }
  });
});
