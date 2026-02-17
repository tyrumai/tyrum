/**
 * Watcher processor -- port of services/tyrum-watchers/
 *
 * Subscribes to plan lifecycle events on the gateway event bus and
 * evaluates trigger conditions stored in the watchers table.  When a
 * trigger fires it records an episodic event through the MemoryDal.
 */

import type { Emitter, Handler } from "mitt";
import type Database from "better-sqlite3";
import type { GatewayEvents } from "../../event-bus.js";
import type { MemoryDal } from "../memory/dal.js";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface WatcherRow {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: unknown;
  active: number;
  created_at: string;
  updated_at: string;
}

interface RawWatcherRow {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: string;
  active: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Trigger config types
// ---------------------------------------------------------------------------

export interface PlanCompleteTriggerConfig {
  planId: string;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface WatcherProcessorOptions {
  db: Database.Database;
  memoryDal: MemoryDal;
  eventBus: Emitter<GatewayEvents>;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

function parseRow(row: RawWatcherRow): WatcherRow {
  return {
    ...row,
    trigger_config: JSON.parse(row.trigger_config) as unknown,
  };
}

export class WatcherProcessor {
  private readonly db: Database.Database;
  private readonly memoryDal: MemoryDal;
  private readonly eventBus: Emitter<GatewayEvents>;

  private completedHandler: Handler<GatewayEvents["plan:completed"]> | undefined;
  private failedHandler: Handler<GatewayEvents["plan:failed"]> | undefined;

  constructor(opts: WatcherProcessorOptions) {
    this.db = opts.db;
    this.memoryDal = opts.memoryDal;
    this.eventBus = opts.eventBus;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): void {
    this.completedHandler = (event) => {
      this.onPlanCompleted(event);
    };
    this.failedHandler = (event) => {
      this.onPlanFailed(event);
    };

    this.eventBus.on("plan:completed", this.completedHandler);
    this.eventBus.on("plan:failed", this.failedHandler);
  }

  stop(): void {
    if (this.completedHandler) {
      this.eventBus.off("plan:completed", this.completedHandler);
      this.completedHandler = undefined;
    }
    if (this.failedHandler) {
      this.eventBus.off("plan:failed", this.failedHandler);
      this.failedHandler = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  onPlanCompleted(event: GatewayEvents["plan:completed"]): void {
    const watchers = this.getActiveWatchersForPlan(event.planId);
    for (const watcher of watchers) {
      if (this.evaluateTrigger(watcher, event)) {
        this.memoryDal.insertEpisodicEvent(
          `watcher-${String(watcher.id)}-${event.planId}-completed`,
          new Date().toISOString(),
          "watcher",
          "plan_completed",
          {
            watcherId: watcher.id,
            planId: event.planId,
            stepsExecuted: event.stepsExecuted,
            triggerType: watcher.trigger_type,
          },
        );
      }
    }
  }

  onPlanFailed(event: GatewayEvents["plan:failed"]): void {
    const watchers = this.getActiveWatchersForPlan(event.planId);
    for (const watcher of watchers) {
      this.memoryDal.insertEpisodicEvent(
        `watcher-${String(watcher.id)}-${event.planId}-failed`,
        new Date().toISOString(),
        "watcher",
        "plan_failed",
        {
          watcherId: watcher.id,
          planId: event.planId,
          reason: event.reason,
          triggerType: watcher.trigger_type,
        },
      );

      // Deactivate one-shot watchers on failure
      if (watcher.trigger_type === "plan_complete") {
        this.deactivateWatcher(watcher.id);
      }
    }
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  createWatcher(
    planId: string,
    triggerType: string,
    triggerConfig: unknown,
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO watchers (plan_id, trigger_type, trigger_config)
         VALUES (?, ?, ?)`,
      )
      .run(planId, triggerType, JSON.stringify(triggerConfig));
    return Number(result.lastInsertRowid);
  }

  listWatchers(): WatcherRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM watchers WHERE active = 1 ORDER BY created_at DESC",
      )
      .all() as RawWatcherRow[];
    return rows.map(parseRow);
  }

  deactivateWatcher(watcherId: number): void {
    this.db
      .prepare(
        "UPDATE watchers SET active = 0, updated_at = datetime('now') WHERE id = ?",
      )
      .run(watcherId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getActiveWatchersForPlan(planId: string): WatcherRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM watchers WHERE plan_id = ? AND active = 1",
      )
      .all(planId) as RawWatcherRow[];
    return rows.map(parseRow);
  }

  private evaluateTrigger(
    watcher: WatcherRow,
    _event: GatewayEvents["plan:completed"],
  ): boolean {
    switch (watcher.trigger_type) {
      case "plan_complete":
        // plan_complete triggers fire whenever the associated plan completes
        return true;
      case "periodic":
        // Periodic triggers are evaluated by a separate scheduler; skip here
        return false;
      default:
        return false;
    }
  }
}
