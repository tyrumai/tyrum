import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionDaemon } from "../../src/modules/retention/daemon.js";
import { pruneByAge, pruneByCount } from "../../src/modules/retention/dal.js";
import type { RetentionPolicy } from "../../src/modules/retention/config.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("RetentionDaemon", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("pruneByAge", () => {
    it("deletes rows older than cutoff", async () => {
      const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      await db.run(
        `INSERT INTO episodic_events (event_id, occurred_at, channel, event_type, payload, created_at)
         VALUES (?, ?, 'test', 'test', '{}', ?)`,
        ["old-1", old, old],
      );
      await db.run(
        `INSERT INTO episodic_events (event_id, occurred_at, channel, event_type, payload, created_at)
         VALUES (?, ?, 'test', 'test', '{}', ?)`,
        ["recent-1", recent, recent],
      );

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = await pruneByAge(db, "episodic_events", "created_at", cutoff);

      expect(deleted).toBe(1);

      const remaining = await db.all<{ event_id: string }>(
        "SELECT event_id FROM episodic_events",
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.event_id).toBe("recent-1");
    });
  });

  describe("pruneByCount", () => {
    it("deletes excess rows keeping most recent", async () => {
      for (let i = 0; i < 5; i++) {
        const ts = new Date(Date.now() - (5 - i) * 1000).toISOString();
        await db.run(
          `INSERT INTO episodic_events (event_id, occurred_at, channel, event_type, payload, created_at)
           VALUES (?, ?, 'test', 'test', '{}', ?)`,
          [`evt-${i}`, ts, ts],
        );
      }

      const deleted = await pruneByCount(db, "episodic_events", 2, "created_at");

      expect(deleted).toBe(3);

      const remaining = await db.all<{ event_id: string }>(
        "SELECT event_id FROM episodic_events ORDER BY created_at ASC",
      );
      expect(remaining).toHaveLength(2);
    });
  });

  describe("tick", () => {
    it("processes all policies and returns total count", async () => {
      const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        `INSERT INTO episodic_events (event_id, occurred_at, channel, event_type, payload, created_at)
         VALUES (?, ?, 'test', 'test', '{}', ?)`,
        ["old-evt", old, old],
      );

      const policies: RetentionPolicy[] = [
        { table: "episodic_events", maxAgeDays: 30, timestampColumn: "created_at" },
      ];

      const daemon = new RetentionDaemon({ db, policies, intervalMs: 100_000 });
      const total = await daemon.tick();

      expect(total).toBe(1);
    });
  });

  describe("start/stop", () => {
    it("manages the interval timer", () => {
      const daemon = new RetentionDaemon({ db, intervalMs: 100_000 });
      daemon.start();
      daemon.start(); // idempotent
      daemon.stop();
      daemon.stop(); // safe double-stop
    });

    it("runs tick on interval", async () => {
      vi.useFakeTimers();
      const policies: RetentionPolicy[] = [];
      const daemon = new RetentionDaemon({ db, policies, intervalMs: 100 });
      const tickSpy = vi.spyOn(daemon, "tick").mockResolvedValue(0);

      daemon.start();
      await vi.advanceTimersByTimeAsync(250);
      daemon.stop();
      vi.useRealTimers();

      expect(tickSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
