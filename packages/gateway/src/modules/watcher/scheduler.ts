/**
 * Watcher scheduler — periodic tick for time-based watchers.
 *
 * Queries active periodic watchers on each tick, evaluates whether
 * their interval has elapsed since last fire, and creates plans for
 * matching watchers via the event bus.
 */

import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type { MemoryDal } from "../memory/dal.js";
import type { SqlDb } from "../../statestore/types.js";
import { randomUUID } from "node:crypto";

const DEFAULT_TICK_MS = 60_000;

interface RawPeriodicWatcherRow {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: string;
  active: number;
  last_fired_at_ms?: number | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodicTriggerConfig {
  intervalMs: number;
}

export interface WatcherSchedulerOptions {
  db: SqlDb;
  memoryDal: MemoryDal;
  eventBus: Emitter<GatewayEvents>;
  tickMs?: number;
  /** Lease owner id for HA scheduler coordination. Defaults to a random id. */
  leaseOwner?: string;
  /** Lease name used in the scheduler_leases table. Defaults to "watcher-scheduler". */
  leaseName?: string;
  /** Lease TTL in milliseconds. Defaults to max(5000, tickMs * 2). */
  leaseTtlMs?: number;
  /**
   * When true, the scheduler interval will keep the Node.js process alive.
   * Defaults to false so background scheduling doesn't block graceful shutdown.
   */
  keepProcessAlive?: boolean;
}

export class WatcherScheduler {
  private readonly db: SqlDb;
  private readonly memoryDal: MemoryDal;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly tickMs: number;
  private readonly leaseOwner: string;
  private readonly leaseName: string;
  private readonly leaseTtlMs: number;
  private readonly keepProcessAlive: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: WatcherSchedulerOptions) {
    this.db = opts.db;
    this.memoryDal = opts.memoryDal;
    this.eventBus = opts.eventBus;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.leaseOwner = opts.leaseOwner ?? `sched-${randomUUID()}`;
    this.leaseName = opts.leaseName ?? "watcher-scheduler";
    this.leaseTtlMs = Math.max(5_000, opts.leaseTtlMs ?? this.tickMs * 2);
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    if (!this.keepProcessAlive) {
      // Don't prevent process exit (useful in embedded / test scenarios).
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing -- runs one scheduler cycle. */
  async tick(): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const leaseOk = await this.tryAcquireLease(now);
    if (!leaseOk) return;

    const watchers = await this.getActivePeriodicWatchers();

    for (const watcher of watchers) {
      let config: PeriodicTriggerConfig;
      try {
        config = JSON.parse(watcher.trigger_config) as PeriodicTriggerConfig;
      } catch {
        continue;
      }

      if (!config.intervalMs || config.intervalMs <= 0) {
        continue;
      }

      const intervalMs = config.intervalMs;
      const bucketMs = Math.floor(now / intervalMs) * intervalMs;
      const lastFiredAt = watcher.last_fired_at_ms ?? 0;
      if (lastFiredAt >= bucketMs) {
        continue;
      }

      const firingId = `periodic-${String(watcher.id)}-${String(bucketMs)}`;

      const claimed = await this.db.transaction(async (tx) => {
        const inserted = await tx.run(
          `INSERT INTO trigger_firings (firing_id, watcher_id, trigger_type, scheduled_at_ms, created_at)
           VALUES (?, ?, 'periodic', ?, ?)
           ON CONFLICT (firing_id) DO NOTHING`,
          [firingId, watcher.id, bucketMs, nowIso],
        );
        if (inserted.changes !== 1) return false;

        const updated = await tx.run(
          `UPDATE watchers
           SET last_fired_at_ms = ?, updated_at = ?
           WHERE id = ? AND trigger_type = 'periodic' AND active = 1`,
          [bucketMs, nowIso, watcher.id],
        );
        return updated.changes === 1;
      });

      if (!claimed) continue;

      await this.fireWatcher(watcher, bucketMs, firingId);
    }
  }

  private async tryAcquireLease(nowMs: number): Promise<boolean> {
    const expiresAtMs = nowMs + this.leaseTtlMs;
    const result = await this.db.run(
      `INSERT INTO scheduler_leases (lease_name, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (lease_name) DO UPDATE SET
         lease_owner = excluded.lease_owner,
         lease_expires_at_ms = excluded.lease_expires_at_ms
       WHERE scheduler_leases.lease_expires_at_ms <= ? OR scheduler_leases.lease_owner = ?`,
      [this.leaseName, this.leaseOwner, expiresAtMs, nowMs, this.leaseOwner],
    );
    return result.changes === 1;
  }

  private async getActivePeriodicWatchers(): Promise<RawPeriodicWatcherRow[]> {
    return await this.db.all<RawPeriodicWatcherRow>(
      "SELECT * FROM watchers WHERE trigger_type = 'periodic' AND active = 1",
    );
  }

  private async fireWatcher(
    watcher: RawPeriodicWatcherRow,
    occurredAtMs: number,
    firingId: string,
  ): Promise<void> {
    const eventId = firingId;
    const agentId = process.env["TYRUM_AGENT_ID"]?.trim() || "default";

    await this.memoryDal.insertEpisodicEvent(
      agentId,
      eventId,
      new Date(occurredAtMs).toISOString(),
      "watcher",
      "periodic_fired",
      {
        watcherId: watcher.id,
        planId: watcher.plan_id,
        triggerType: "periodic",
        firingId,
      },
    );

    this.eventBus.emit("watcher:fired", {
      watcherId: watcher.id,
      planId: watcher.plan_id,
      triggerType: "periodic",
    });
  }
}
