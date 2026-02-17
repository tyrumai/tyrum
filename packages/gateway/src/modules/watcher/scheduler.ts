/**
 * Watcher scheduler — periodic tick for time-based watchers.
 *
 * Queries active periodic watchers on each tick, evaluates whether
 * their interval has elapsed since last fire, and creates plans for
 * matching watchers via the event bus.
 */

import type Database from "better-sqlite3";
import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type { MemoryDal } from "../memory/dal.js";

const DEFAULT_TICK_MS = 60_000;

interface RawPeriodicWatcherRow {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface PeriodicTriggerConfig {
  intervalMs: number;
}

export interface WatcherSchedulerOptions {
  db: Database.Database;
  memoryDal: MemoryDal;
  eventBus: Emitter<GatewayEvents>;
  tickMs?: number;
}

export class WatcherScheduler {
  private readonly db: Database.Database;
  private readonly memoryDal: MemoryDal;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly lastFired = new Map<number, number>();

  constructor(opts: WatcherSchedulerOptions) {
    this.db = opts.db;
    this.memoryDal = opts.memoryDal;
    this.eventBus = opts.eventBus;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.tickMs);
    // Don't prevent process exit
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing -- runs one scheduler cycle. */
  tick(): void {
    const watchers = this.getActivePeriodicWatchers();
    const now = Date.now();

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

      const lastFiredAt = this.lastFired.get(watcher.id) ?? 0;
      if (now - lastFiredAt < config.intervalMs) {
        continue;
      }

      this.lastFired.set(watcher.id, now);
      this.fireWatcher(watcher, now);
    }
  }

  private getActivePeriodicWatchers(): RawPeriodicWatcherRow[] {
    return this.db
      .prepare(
        "SELECT * FROM watchers WHERE trigger_type = 'periodic' AND active = 1",
      )
      .all() as RawPeriodicWatcherRow[];
  }

  private fireWatcher(watcher: RawPeriodicWatcherRow, now: number): void {
    const eventId = `scheduler-${String(watcher.id)}-${String(now)}`;

    this.memoryDal.insertEpisodicEvent(
      eventId,
      new Date(now).toISOString(),
      "watcher",
      "periodic_fired",
      {
        watcherId: watcher.id,
        planId: watcher.plan_id,
        triggerType: "periodic",
      },
    );

    this.eventBus.emit("watcher:fired", {
      watcherId: watcher.id,
      planId: watcher.plan_id,
      triggerType: "periodic",
    });
  }
}
