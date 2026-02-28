/**
 * Watcher processor -- port of services/tyrum-watchers/
 *
 * Subscribes to plan lifecycle events on the gateway event bus and
 * evaluates trigger conditions stored in the watchers table.  When a
 * trigger fires it records an episodic event through Memory v1.
 */

import type { Emitter, Handler } from "mitt";
import { createHash } from "node:crypto";
import type { GatewayEvents } from "../../event-bus.js";
import type { SqlDb } from "../../statestore/types.js";
import type { MemoryV1Dal } from "../memory/v1-dal.js";
import { recordMemoryV1SystemEpisode } from "../memory/v1-episode-recorder.js";
import { WatcherFiringDal } from "./firing-dal.js";

const DEFAULT_WEBHOOK_SCHEDULED_AT_CURSOR_MAX_ENTRIES = 10_000;

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
  created_at: string | Date;
  updated_at: string | Date;
}

// ---------------------------------------------------------------------------
// Trigger config types
// ---------------------------------------------------------------------------

export interface PlanCompleteTriggerConfig {
  planId: string;
}

export interface WebhookTriggerEvent {
  timestampMs: number;
  nonce: string;
  bodySha256: string;
  bodyBytes: number;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface WatcherProcessorOptions {
  db: SqlDb;
  memoryV1Dal: MemoryV1Dal;
  eventBus: Emitter<GatewayEvents>;
  /** Max entries for the webhook scheduled_at cursor cache (default: 10_000). Set to 0 to disable caching. */
  webhookScheduledAtCursorMaxEntries?: number;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

function parseRow(row: RawWatcherRow): WatcherRow {
  return {
    ...row,
    trigger_config: JSON.parse(row.trigger_config) as unknown,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export class WatcherProcessor {
  private readonly db: SqlDb;
  private readonly memoryV1Dal: MemoryV1Dal;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly firingDal: WatcherFiringDal;
  private readonly webhookScheduledAtCursorMaxEntries: number;
  private readonly webhookScheduledAtCursor = new Map<number, { baseMs: number; nextMs: number }>();

  private completedHandler: Handler<GatewayEvents["plan:completed"]> | undefined;
  private failedHandler: Handler<GatewayEvents["plan:failed"]> | undefined;

  constructor(opts: WatcherProcessorOptions) {
    this.db = opts.db;
    this.memoryV1Dal = opts.memoryV1Dal;
    this.eventBus = opts.eventBus;
    this.firingDal = new WatcherFiringDal(opts.db);
    this.webhookScheduledAtCursorMaxEntries = (() => {
      const raw = opts.webhookScheduledAtCursorMaxEntries;
      if (raw === undefined) return DEFAULT_WEBHOOK_SCHEDULED_AT_CURSOR_MAX_ENTRIES;
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return DEFAULT_WEBHOOK_SCHEDULED_AT_CURSOR_MAX_ENTRIES;
      }
      return Math.max(0, Math.floor(raw));
    })();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  private setWebhookScheduledAtCursorEntry(
    watcherId: number,
    entry: { baseMs: number; nextMs: number },
  ): void {
    if (this.webhookScheduledAtCursorMaxEntries <= 0) return;

    // Maintain insertion order as an LRU by moving touched keys to the end.
    if (this.webhookScheduledAtCursor.has(watcherId)) {
      this.webhookScheduledAtCursor.delete(watcherId);
    }
    this.webhookScheduledAtCursor.set(watcherId, entry);

    while (this.webhookScheduledAtCursor.size > this.webhookScheduledAtCursorMaxEntries) {
      const oldest = this.webhookScheduledAtCursor.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.webhookScheduledAtCursor.delete(oldest);
    }
  }

  start(): void {
    this.completedHandler = (event) => {
      void this.onPlanCompleted(event).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("watcher.plan_completed_handler_failed", {
          plan_id: event.planId,
          error: message,
        });
      });
    };
    this.failedHandler = (event) => {
      void this.onPlanFailed(event).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("watcher.plan_failed_handler_failed", {
          plan_id: event.planId,
          error: message,
        });
      });
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

  async onPlanCompleted(event: GatewayEvents["plan:completed"]): Promise<void> {
    const watchers = await this.getActiveWatchersForPlan(event.planId);
    for (const watcher of watchers) {
      if (!this.evaluateTrigger(watcher, event)) continue;
      try {
        await recordMemoryV1SystemEpisode(
          this.memoryV1Dal,
          {
            occurred_at: new Date().toISOString(),
            channel: "watcher",
            event_type: "plan_completed",
            summary_md: `Watcher fired: plan_completed`,
            tags: ["watcher", `watcher_id:${String(watcher.id)}`, `plan_id:${event.planId}`],
            metadata: {
              watcher_id: watcher.id,
              plan_id: event.planId,
              steps_executed: event.stepsExecuted,
              trigger_type: watcher.trigger_type,
            },
          },
          "default",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("watcher.plan_completed_episode_record_failed", {
          watcher_id: watcher.id,
          plan_id: event.planId,
          error: message,
        });
      }
    }
  }

  async onPlanFailed(event: GatewayEvents["plan:failed"]): Promise<void> {
    const watchers = await this.getActiveWatchersForPlan(event.planId);
    for (const watcher of watchers) {
      try {
        await recordMemoryV1SystemEpisode(
          this.memoryV1Dal,
          {
            occurred_at: new Date().toISOString(),
            channel: "watcher",
            event_type: "plan_failed",
            summary_md: `Watcher fired: plan_failed`,
            tags: ["watcher", `watcher_id:${String(watcher.id)}`, `plan_id:${event.planId}`],
            metadata: {
              watcher_id: watcher.id,
              plan_id: event.planId,
              reason: event.reason,
              trigger_type: watcher.trigger_type,
            },
          },
          "default",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("watcher.plan_failed_episode_record_failed", {
          watcher_id: watcher.id,
          plan_id: event.planId,
          error: message,
        });
      }

      if (watcher.trigger_type === "plan_complete") {
        await this.deactivateWatcher(watcher.id);
      }
    }
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  createWatcher(planId: string, triggerType: string, triggerConfig: unknown): Promise<number> {
    const nowIso = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{ id: number }>(
        `INSERT INTO watchers (plan_id, trigger_type, trigger_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id`,
        [planId, triggerType, JSON.stringify(triggerConfig), nowIso, nowIso],
      );
      if (!row) {
        throw new Error("failed to create watcher");
      }
      return Number(row.id);
    });
  }

  async listWatchers(): Promise<WatcherRow[]> {
    const rows = await this.db.all<RawWatcherRow>(
      "SELECT * FROM watchers WHERE active = 1 ORDER BY created_at DESC",
    );
    return rows.map(parseRow);
  }

  async getActiveWatcherById(watcherId: number): Promise<WatcherRow | null> {
    const row = await this.db.get<RawWatcherRow>(
      "SELECT * FROM watchers WHERE id = ? AND active = 1",
      [watcherId],
    );
    return row ? parseRow(row) : null;
  }

  async deactivateWatcher(watcherId: number): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run("UPDATE watchers SET active = 0, updated_at = ? WHERE id = ?", [
      nowIso,
      watcherId,
    ]);
    this.webhookScheduledAtCursor.delete(watcherId);
  }

  async recordWebhookTrigger(watcher: WatcherRow, event: WebhookTriggerEvent): Promise<boolean> {
    if (watcher.trigger_type !== "webhook") {
      return false;
    }

    const replayDigest = createHash("sha256").update(event.nonce).digest("hex");
    const firingId = `webhook-${String(watcher.id)}-${replayDigest}`;

    const existing = await this.firingDal.getById(firingId);
    if (existing) {
      return false;
    }

    const maxScheduledAtSearch = 10_000;
    const baseScheduledAtMs = Math.floor(event.timestampMs);
    const scheduledAtMaxExclusive = baseScheduledAtMs + maxScheduledAtSearch;
    const cursor = this.webhookScheduledAtCursor.get(watcher.id);
    const startScheduledAtMs =
      cursor && cursor.baseMs === baseScheduledAtMs ? cursor.nextMs : baseScheduledAtMs;

    for (let attempt = 0; attempt < maxScheduledAtSearch; attempt += 1) {
      const scheduledAtMs = startScheduledAtMs + attempt;
      if (scheduledAtMs >= scheduledAtMaxExclusive) {
        throw new Error("failed to allocate unique scheduled_at_ms for webhook firing");
      }

      const created = await this.firingDal.createIfAbsent({
        firingId,
        watcherId: watcher.id,
        planId: watcher.plan_id,
        triggerType: watcher.trigger_type,
        scheduledAtMs,
      });
      if (created.row.firing_id === firingId) {
        if (!created.created) {
          return false;
        }
        const nextMs = Math.max(startScheduledAtMs, created.row.scheduled_at_ms + 1);
        this.setWebhookScheduledAtCursorEntry(watcher.id, { baseMs: baseScheduledAtMs, nextMs });
        break;
      }
      if (attempt === maxScheduledAtSearch - 1) {
        throw new Error("failed to allocate unique scheduled_at_ms for webhook firing");
      }
    }

    try {
      await recordMemoryV1SystemEpisode(
        this.memoryV1Dal,
        {
          occurred_at: new Date(event.timestampMs).toISOString(),
          channel: "watcher",
          event_type: "webhook_fired",
          summary_md: `Watcher fired: webhook_fired`,
          tags: ["watcher", `watcher_id:${String(watcher.id)}`, `plan_id:${watcher.plan_id}`],
          metadata: {
            firing_id: firingId,
            watcher_id: watcher.id,
            plan_id: watcher.plan_id,
            trigger_type: watcher.trigger_type,
            timestamp_ms: event.timestampMs,
            nonce: event.nonce,
            body_sha256: event.bodySha256,
            body_bytes: event.bodyBytes,
          },
        },
        "default",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("watcher.webhook_episode_record_failed", {
        watcher_id: watcher.id,
        plan_id: watcher.plan_id,
        firing_id: firingId,
        error: message,
      });
    }

    this.eventBus.emit("watcher:fired", {
      watcherId: watcher.id,
      planId: watcher.plan_id,
      triggerType: watcher.trigger_type,
    });
    return true;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async getActiveWatchersForPlan(planId: string): Promise<WatcherRow[]> {
    const rows = await this.db.all<RawWatcherRow>(
      "SELECT * FROM watchers WHERE plan_id = ? AND active = 1",
      [planId],
    );
    return rows.map(parseRow);
  }

  private evaluateTrigger(watcher: WatcherRow, _event: GatewayEvents["plan:completed"]): boolean {
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
