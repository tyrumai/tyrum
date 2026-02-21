/**
 * Watcher scheduler -- periodic tick for time-based watchers.
 *
 * Uses per-watcher leases to safely coordinate across multiple
 * gateway instances.  Each fired watcher gets a unique firing_id
 * recorded in the watcher_firings table.
 */

import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type { MemoryDal } from "../memory/dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { PolicyBundleManager } from "../policy/bundle.js";
import type { Logger } from "../observability/logger.js";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 120_000;

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
  leaseMs?: number;
  schedulerOwner?: string;
  /**
   * When true, the scheduler interval will keep the Node.js process alive.
   * Defaults to false so background scheduling doesn't block graceful shutdown.
   */
  keepProcessAlive?: boolean;
  policyBundleManager?: PolicyBundleManager;
  logger?: Logger;
}

export class WatcherScheduler {
  private readonly db: SqlDb;
  private readonly memoryDal: MemoryDal;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly tickMs: number;
  private readonly leaseMs: number;
  private readonly schedulerOwner: string;
  private readonly keepProcessAlive: boolean;
  private readonly policyBundleManager?: PolicyBundleManager;
  private readonly logger?: Logger;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: WatcherSchedulerOptions) {
    this.db = opts.db;
    this.memoryDal = opts.memoryDal;
    this.eventBus = opts.eventBus;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
    this.schedulerOwner = opts.schedulerOwner ?? crypto.randomUUID();
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.policyBundleManager = opts.policyBundleManager;
    this.logger = opts.logger;
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
    const watchers = await this.getActivePeriodicWatchers();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const leaseExpiry = now + this.leaseMs;

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

      const lastFiredAt = watcher.last_fired_at_ms ?? 0;
      if (now - lastFiredAt < config.intervalMs) {
        continue;
      }

      // Acquire lease for this watcher
      const leased = await this.db.run(
        `UPDATE watchers
         SET scheduler_owner = ?, scheduler_lease_expires_at_ms = ?,
             last_fired_at_ms = ?, updated_at = ?
         WHERE id = ? AND trigger_type = 'periodic' AND active = 1
           AND (last_fired_at_ms IS NULL OR ? - last_fired_at_ms >= ?)
           AND (scheduler_owner IS NULL OR scheduler_lease_expires_at_ms < ?)`,
        [this.schedulerOwner, leaseExpiry, now, nowIso, watcher.id, now, config.intervalMs, now],
      );
      if (leased.changes !== 1) {
        continue;
      }

      await this.fireWatcher(watcher, now);
    }
  }

  private async getActivePeriodicWatchers(): Promise<RawPeriodicWatcherRow[]> {
    return await this.db.all<RawPeriodicWatcherRow>(
      "SELECT * FROM watchers WHERE trigger_type = 'periodic' AND active = 1",
    );
  }

  private async fireWatcher(watcher: RawPeriodicWatcherRow, now: number): Promise<void> {
    // Policy gate: check if automation is allowed
    if (this.policyBundleManager) {
      const decision = this.policyBundleManager.evaluate("automation", {
        watcher_id: watcher.id,
        trigger_type: "periodic",
      });
      if (decision.action === "deny") {
        this.logger?.warn("watcher.fire_denied_by_policy", {
          watcher_id: watcher.id,
          plan_id: watcher.plan_id,
          detail: decision.detail,
        });
        return;
      }
    }

    const firingId = crypto.randomUUID();
    const eventId = `scheduler-${String(watcher.id)}-${String(now)}`;

    // Record firing in watcher_firings table
    await this.db.run(
      `INSERT INTO watcher_firings (firing_id, watcher_id, status, created_at)
       VALUES (?, ?, 'pending', ?)`,
      [firingId, watcher.id, new Date(now).toISOString()],
    );

    await this.memoryDal.insertEpisodicEvent(
      eventId,
      new Date(now).toISOString(),
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
      firingId,
    });
  }
}
