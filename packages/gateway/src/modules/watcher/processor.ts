/**
 * Watcher processor -- port of services/tyrum-watchers/
 *
 * Subscribes to watcher-relevant gateway events and produces durable
 * watcher firings for downstream automation/audit.
 */

import type { Emitter, Handler } from "mitt";
import { createHash, randomUUID } from "node:crypto";
import type { GatewayEvents } from "../../event-bus.js";
import type { SqlDb } from "../../statestore/types.js";
import { sqlActiveWhereClause, sqlBoolParam } from "../../statestore/sql.js";
import { WatcherFiringDal } from "./firing-dal.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../identity/scope.js";

const DEFAULT_WEBHOOK_SCHEDULED_AT_CURSOR_MAX_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface WatcherRow {
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  workspace_id: string;
  trigger_type: string;
  trigger_config: unknown;
  active: number | boolean;
  last_fired_at_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface RawWatcherRow {
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  workspace_id: string;
  trigger_type: string;
  trigger_config_json: string;
  active: number | boolean;
  last_fired_at_ms: number | null;
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
    trigger_config: JSON.parse(row.trigger_config_json) as unknown,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function deterministicUuidFromHash(bytes: Buffer): string {
  if (bytes.length < 16) {
    throw new Error("hash too short for uuid");
  }
  const uuid = Buffer.from(bytes.subarray(0, 16));
  // RFC4122 variant + v4 bits.
  uuid[6] = (uuid[6]! & 0x0f) | 0x40;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  const hex = uuid.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function webhookFiringId(input: { tenantId: string; watcherId: string; nonce: string }): string {
  const digest = createHash("sha256")
    .update("watcher:webhook:")
    .update(input.tenantId)
    .update(":")
    .update(input.watcherId)
    .update(":")
    .update(input.nonce)
    .digest();
  return deterministicUuidFromHash(digest);
}

function normalizeConfigForPlanId(input: { planId: string; triggerConfig: unknown }): unknown {
  const planId = input.planId.trim();
  if (!planId) return input.triggerConfig ?? {};
  if (!input.triggerConfig || typeof input.triggerConfig !== "object") {
    return { planId };
  }
  if (Array.isArray(input.triggerConfig)) {
    return { planId };
  }
  const cfg = input.triggerConfig as Record<string, unknown>;
  if (typeof cfg["planId"] === "string" && cfg["planId"].trim().length > 0) {
    return cfg;
  }
  return { ...cfg, planId };
}

export class WatcherProcessor {
  private readonly db: SqlDb;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly firingDal: WatcherFiringDal;
  private readonly webhookScheduledAtCursorMaxEntries: number;
  private readonly webhookScheduledAtCursor = new Map<string, { baseMs: number; nextMs: number }>();

  private failedHandler: Handler<GatewayEvents["plan:failed"]> | undefined;

  constructor(opts: WatcherProcessorOptions) {
    this.db = opts.db;
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
    watcherId: string,
    entry: { baseMs: number; nextMs: number },
  ): void {
    if (this.webhookScheduledAtCursorMaxEntries <= 0) return;

    // Maintain insertion order as an LRU by moving touched keys to the end.
    if (this.webhookScheduledAtCursor.has(watcherId)) {
      this.webhookScheduledAtCursor.delete(watcherId);
    }
    this.webhookScheduledAtCursor.set(watcherId, entry);

    while (this.webhookScheduledAtCursor.size > this.webhookScheduledAtCursorMaxEntries) {
      const oldest = this.webhookScheduledAtCursor.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.webhookScheduledAtCursor.delete(oldest);
    }
  }

  start(): void {
    this.failedHandler = (event) => {
      void this.onPlanFailed(event).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("watcher.plan_failed_handler_failed", {
          plan_id: event.planId,
          error: message,
        });
      });
    };

    this.eventBus.on("plan:failed", this.failedHandler);
  }

  stop(): void {
    if (this.failedHandler) {
      this.eventBus.off("plan:failed", this.failedHandler);
      this.failedHandler = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  async onPlanCompleted(_event: GatewayEvents["plan:completed"]): Promise<void> {
    // Plan-complete watchers no longer perform work at completion time. Keep
    // the method for compatibility with direct callers and tests.
  }

  async onPlanFailed(event: GatewayEvents["plan:failed"]): Promise<void> {
    const watchers = await this.getActiveWatchersForPlan(DEFAULT_TENANT_ID, event.planId);
    for (const watcher of watchers) {
      if (watcher.trigger_type === "plan_complete") {
        await this.deactivateWatcher(watcher.watcher_id);
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
    opts?: {
      tenantId?: string;
      agentId?: string;
      workspaceId?: string;
      watcherKey?: string;
    },
  ): Promise<string> {
    const nowIso = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
      const agentId = opts?.agentId ?? DEFAULT_AGENT_ID;
      const workspaceId = opts?.workspaceId ?? DEFAULT_WORKSPACE_ID;
      const watcherId = randomUUID();
      const watcherKey = opts?.watcherKey?.trim() || `watcher-${watcherId}`;
      const configJson = JSON.stringify(
        normalizeConfigForPlanId({ planId, triggerConfig: triggerConfig ?? {} }),
      );

      const row = await tx.get<{ watcher_id: string }>(
        `INSERT INTO watchers (
           tenant_id,
           watcher_id,
           watcher_key,
           agent_id,
           workspace_id,
           trigger_type,
           trigger_config_json,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING watcher_id`,
        [
          tenantId,
          watcherId,
          watcherKey,
          agentId,
          workspaceId,
          triggerType,
          configJson,
          nowIso,
          nowIso,
        ],
      );
      if (!row) {
        throw new Error("failed to create watcher");
      }
      return row.watcher_id;
    });
  }

  async listWatchers(tenantId: string = DEFAULT_TENANT_ID): Promise<WatcherRow[]> {
    const activeWhere = sqlActiveWhereClause(this.db);
    const rows = await this.db.all<RawWatcherRow>(
      `SELECT * FROM watchers WHERE tenant_id = ? AND ${activeWhere.sql} ORDER BY created_at DESC`,
      [tenantId, ...activeWhere.params],
    );
    return rows.map(parseRow);
  }

  async getActiveWatcherById(
    watcherId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<WatcherRow | null> {
    const activeWhere = sqlActiveWhereClause(this.db);
    const row = await this.db.get<RawWatcherRow>(
      `SELECT * FROM watchers WHERE tenant_id = ? AND watcher_id = ? AND ${activeWhere.sql}`,
      [tenantId, watcherId, ...activeWhere.params],
    );
    return row ? parseRow(row) : null;
  }

  async deactivateWatcher(watcherId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE watchers
       SET active = ?, updated_at = ?
       WHERE tenant_id = ? AND watcher_id = ?`,
      [sqlBoolParam(this.db, false), nowIso, tenantId, watcherId],
    );
    this.webhookScheduledAtCursor.delete(watcherId);
  }

  async recordWebhookTrigger(watcher: WatcherRow, event: WebhookTriggerEvent): Promise<boolean> {
    if (watcher.trigger_type !== "webhook") {
      return false;
    }

    const firingId = webhookFiringId({
      tenantId: watcher.tenant_id,
      watcherId: watcher.watcher_id,
      nonce: event.nonce,
    });

    const existing = await this.firingDal.getById({
      tenantId: watcher.tenant_id,
      watcherFiringId: firingId,
    });
    if (existing) {
      return false;
    }

    const maxScheduledAtSearch = 10_000;
    const baseScheduledAtMs = Math.floor(event.timestampMs);
    const scheduledAtMaxExclusive = baseScheduledAtMs + maxScheduledAtSearch;
    const cursor = this.webhookScheduledAtCursor.get(watcher.watcher_id);
    const startScheduledAtMs =
      cursor && cursor.baseMs === baseScheduledAtMs ? cursor.nextMs : baseScheduledAtMs;

    for (let attempt = 0; attempt < maxScheduledAtSearch; attempt += 1) {
      const scheduledAtMs = startScheduledAtMs + attempt;
      if (scheduledAtMs >= scheduledAtMaxExclusive) {
        throw new Error("failed to allocate unique scheduled_at_ms for webhook firing");
      }

      const created = await this.firingDal.createIfAbsent({
        tenantId: watcher.tenant_id,
        watcherFiringId: firingId,
        watcherId: watcher.watcher_id,
        scheduledAtMs,
      });
      if (created.row.watcher_firing_id === firingId) {
        if (!created.created) {
          return false;
        }
        const nextMs = Math.max(startScheduledAtMs, created.row.scheduled_at_ms + 1);
        this.setWebhookScheduledAtCursorEntry(watcher.watcher_id, {
          baseMs: baseScheduledAtMs,
          nextMs,
        });
        break;
      }
      if (attempt === maxScheduledAtSearch - 1) {
        throw new Error("failed to allocate unique scheduled_at_ms for webhook firing");
      }
    }

    const planId = (() => {
      const cfg = watcher.trigger_config as Record<string, unknown> | undefined;
      const raw = cfg ? cfg["planId"] : undefined;
      return typeof raw === "string" ? raw : "";
    })();

    this.eventBus.emit("watcher:fired", {
      watcherId: watcher.watcher_id,
      planId,
      triggerType: watcher.trigger_type,
    });
    return true;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async getActiveWatchersForPlan(tenantId: string, planId: string): Promise<WatcherRow[]> {
    const activeWhere = sqlActiveWhereClause(this.db);
    const rows = await this.db.all<RawWatcherRow>(
      `SELECT * FROM watchers WHERE tenant_id = ? AND ${activeWhere.sql}`,
      [tenantId, ...activeWhere.params],
    );
    const parsed = rows.map(parseRow);
    return parsed.filter((watcher) => {
      const cfg = watcher.trigger_config as Record<string, unknown> | undefined;
      const id = cfg ? cfg["planId"] : undefined;
      return typeof id === "string" && id === planId;
    });
  }
}
