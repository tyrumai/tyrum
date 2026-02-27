/**
 * WorkSignal scheduler/watchers — evaluates event-based triggers and processes firings.
 *
 * v1 supports a single trigger kind: WorkItem status transitions.
 *
 * Core properties:
 * - Durable firings with DB-lease ownership (cluster safe)
 * - Deduped per (signal_id, dedupe_key) for at-most-once firing
 * - Bounded retries with exponential backoff for transient failures
 */

import type { WsEventEnvelope, WorkItemState } from "@tyrum/schemas";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import { shouldDeliverToWsAudience, type WsBroadcastAudience } from "../../ws/audience.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { OutboxDal } from "../backplane/outbox-dal.js";
import { WorkboardDal } from "./dal.js";
import { WorkSignalFiringDal, type WorkSignalFiringRow } from "./signal-firing-dal.js";

const WORKBOARD_WS_AUDIENCE: WsBroadcastAudience = {
  roles: ["client"],
  required_scopes: ["operator.read", "operator.write"],
};

const DEFAULT_TICK_MS = 1_000;
const DEFAULT_FIRING_LEASE_TTL_MS = 60_000;
const DEFAULT_PROCESS_BATCH = 25;
const DEFAULT_MAX_ATTEMPTS = 5;

interface RawWorkSignalRow {
  signal_id: string;
  tenant_id: string;
  agent_id: string;
  workspace_id: string;
  work_item_id: string | null;
  trigger_kind: string;
  trigger_spec_json: string;
  payload_json: string | null;
  status: string;
  created_at: string | Date;
  last_fired_at: string | Date | null;
}

interface RawWorkItemEventRow {
  event_id: string;
  work_item_id: string;
  created_at: string | Date;
  kind: string;
  payload_json: string;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWorkItemStatusTransitionTrigger(
  raw: unknown,
): { kind: "work_item.status.transition"; to: WorkItemState[] } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw["kind"] !== "work_item.status.transition") return undefined;
  const toRaw = raw["to"];
  if (!Array.isArray(toRaw) || toRaw.length === 0) return undefined;
  const to: WorkItemState[] = [];
  for (const entry of toRaw) {
    if (typeof entry !== "string") return undefined;
    const normalized = entry.trim().toLowerCase();
    if (
      normalized !== "backlog" &&
      normalized !== "ready" &&
      normalized !== "doing" &&
      normalized !== "blocked" &&
      normalized !== "done" &&
      normalized !== "failed" &&
      normalized !== "cancelled"
    ) {
      return undefined;
    }
    to.push(normalized as WorkItemState);
  }
  return { kind: "work_item.status.transition", to };
}

export interface WorkSignalSchedulerOptions {
  db: SqlDb;
  connectionManager: ConnectionManager;
  owner?: string;
  logger?: Logger;
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
  };
  tickMs?: number;
  firingLeaseTtlMs?: number;
  maxFiringsPerTick?: number;
  maxAttempts?: number;
  /**
   * When true, the scheduler interval will keep the Node.js process alive.
   * Defaults to false so background scheduling doesn't block graceful shutdown.
   */
  keepProcessAlive?: boolean;
}

export class WorkSignalScheduler {
  private readonly db: SqlDb;
  private readonly connectionManager: ConnectionManager;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly cluster?: { edgeId: string; outboxDal: OutboxDal };
  private readonly tickMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly firingLeaseTtlMs: number;
  private readonly maxFiringsPerTick: number;
  private readonly maxAttempts: number;
  private readonly firingDal: WorkSignalFiringDal;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: WorkSignalSchedulerOptions) {
    this.db = opts.db;
    this.connectionManager = opts.connectionManager;
    this.owner = opts.owner?.trim() || "work-signal-scheduler";
    this.logger = opts.logger;
    this.cluster = opts.cluster;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.firingLeaseTtlMs = opts.firingLeaseTtlMs ?? DEFAULT_FIRING_LEASE_TTL_MS;
    this.maxFiringsPerTick = Math.max(
      1,
      Math.min(500, opts.maxFiringsPerTick ?? DEFAULT_PROCESS_BATCH),
    );
    this.maxAttempts = Math.max(1, Math.min(25, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.firingDal = new WorkSignalFiringDal(opts.db);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("work_signal.scheduler_tick_failed", { error: message });
      });
    }, this.tickMs);
    if (!this.keepProcessAlive) {
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
    const signals = await this.getActiveEventSignals();
    for (const signal of signals) {
      const spec = parseWorkItemStatusTransitionTrigger(signal.trigger_spec);
      if (!spec) continue;
      const workItemId = signal.work_item_id;
      if (!workItemId) continue;

      const match = await this.findFirstMatchingStatusTransitionEvent({
        workItemId,
        sinceIso: signal.created_at,
        to: spec.to,
      });
      if (!match) continue;

      const firingId = `work-signal-${signal.signal_id}-${match.event_id}`;
      try {
        await this.firingDal.createIfAbsent({
          firingId,
          signalId: signal.signal_id,
          dedupeKey: match.event_id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("work_signal.firing_create_failed", {
          signal_id: signal.signal_id,
          error: message,
        });
      }
    }

    let processed = 0;
    while (processed < this.maxFiringsPerTick) {
      const firing = await this.firingDal.claimNext({
        owner: this.owner,
        nowMs: Date.now(),
        leaseTtlMs: this.firingLeaseTtlMs,
      });
      if (!firing) break;
      await this.processFiring(firing);
      processed += 1;
    }
  }

  private broadcastEvent(evt: WsEventEnvelope, audience: WsBroadcastAudience): void {
    const payload = JSON.stringify(evt);
    for (const peer of this.connectionManager.allClients()) {
      if (!shouldDeliverToWsAudience(peer, audience)) continue;
      try {
        peer.ws.send(payload);
      } catch {
        // ignore
      }
    }
    if (this.cluster) {
      void this.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: this.cluster.edgeId,
          skip_local: true,
          message: evt,
          audience,
        })
        .catch(() => {
          // ignore
        });
    }
  }

  private async getActiveEventSignals(): Promise<
    Array<{
      signal_id: string;
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string | null;
      created_at: string;
      trigger_spec: unknown;
    }>
  > {
    const rows = await this.db.all<RawWorkSignalRow>(
      `SELECT *
       FROM work_signals
       WHERE trigger_kind = 'event' AND status = 'active'
       ORDER BY created_at ASC, signal_id ASC`,
    );
    return rows.map((r) => ({
      signal_id: r.signal_id,
      tenant_id: r.tenant_id,
      agent_id: r.agent_id,
      workspace_id: r.workspace_id,
      work_item_id: r.work_item_id,
      created_at: normalizeTime(r.created_at),
      trigger_spec: parseJson(r.trigger_spec_json),
    }));
  }

  private async findFirstMatchingStatusTransitionEvent(input: {
    workItemId: string;
    sinceIso: string;
    to: WorkItemState[];
  }): Promise<{ event_id: string } | undefined> {
    const sinceMs = Date.parse(input.sinceIso);
    const rows = await this.db.all<RawWorkItemEventRow>(
      `SELECT *
       FROM work_item_events
       WHERE work_item_id = ? AND kind = 'status.transition'
       ORDER BY created_at ASC, event_id ASC`,
      [input.workItemId],
    );

    for (const row of rows) {
      const createdAtIso = normalizeTime(row.created_at);
      const createdAtMs = Date.parse(createdAtIso);
      if (Number.isFinite(sinceMs) && Number.isFinite(createdAtMs) && createdAtMs < sinceMs) {
        continue;
      }

      const payload = parseJson(row.payload_json);
      const to = isRecord(payload) ? payload["to"] : undefined;
      if (typeof to !== "string") continue;
      const normalized = to.trim().toLowerCase();
      if (input.to.includes(normalized as WorkItemState)) {
        return { event_id: row.event_id };
      }
    }

    return undefined;
  }

  private async processFiring(firing: WorkSignalFiringRow): Promise<void> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    try {
      const result = await this.db.transaction(async (tx) => {
        const firingRow = await tx.get<{
          status: string;
          lease_owner: string | null;
          signal_id: string;
          dedupe_key: string;
        }>("SELECT status, lease_owner, signal_id, dedupe_key FROM work_signal_firings WHERE firing_id = ?", [
          firing.firing_id,
        ]);
        if (!firingRow || firingRow.status !== "processing" || firingRow.lease_owner !== this.owner) {
          return null;
        }

        const signal = await tx.get<RawWorkSignalRow>("SELECT * FROM work_signals WHERE signal_id = ?", [
          firing.signal_id,
        ]);
        if (!signal) {
          await tx.run(
            `UPDATE work_signal_firings
             SET status = 'failed',
                 lease_owner = NULL,
                 lease_expires_at_ms = NULL,
                 error = ?,
                 updated_at = ?
             WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
            ["signal not found", nowIso, firing.firing_id, this.owner],
          );
          return null;
        }

        if (signal.status !== "active") {
          await tx.run(
            `UPDATE work_signal_firings
             SET status = 'failed',
                 lease_owner = NULL,
                 lease_expires_at_ms = NULL,
                 error = ?,
                 updated_at = ?
             WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
            [`signal not active (${signal.status})`, nowIso, firing.firing_id, this.owner],
          );
          return null;
        }

        const dal = new WorkboardDal(tx);

        // Mark the signal fired (durable, prevents repeat evaluation).
        const firedSignal = await dal.markSignalFired({
          scope: {
            tenant_id: signal.tenant_id,
            agent_id: signal.agent_id,
            workspace_id: signal.workspace_id,
          },
          signal_id: signal.signal_id,
          firedAtIso: nowIso,
          status: "fired",
        });
        if (!firedSignal) {
          throw new Error("failed to mark signal fired");
        }

        // Enqueue explicit follow-up work (durable task record) when a work item is attached.
        if (signal.work_item_id) {
          await dal.createTask({
            scope: {
              tenant_id: signal.tenant_id,
              agent_id: signal.agent_id,
              workspace_id: signal.workspace_id,
            },
            task: {
              work_item_id: signal.work_item_id,
              status: "queued",
              execution_profile: "executor",
              side_effect_class: "work.signal",
              result_summary: `Triggered by WorkSignal ${signal.signal_id} (firing ${firing.firing_id})`,
            },
          });
        }

        const updated = await tx.run(
          `UPDATE work_signal_firings
           SET status = 'enqueued',
               lease_owner = NULL,
               lease_expires_at_ms = NULL,
               error = NULL,
               updated_at = ?
           WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
          [nowIso, firing.firing_id, this.owner],
        );
        if (updated.changes !== 1) {
          return null;
        }

        return {
          scope: {
            tenant_id: signal.tenant_id,
            agent_id: signal.agent_id,
            workspace_id: signal.workspace_id,
          },
          signal_id: signal.signal_id,
        };
      });

      if (!result) return;

      this.broadcastEvent(
        {
          event_id: crypto.randomUUID(),
          type: "work.signal.fired",
          occurred_at: nowIso,
          scope: { kind: "agent", agent_id: result.scope.agent_id },
          payload: {
            ...result.scope,
            signal_id: result.signal_id,
            firing_id: firing.firing_id,
          },
        },
        WORKBOARD_WS_AUDIENCE,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.firingDal.markRetryableFailure({
        firingId: firing.firing_id,
        owner: this.owner,
        nowMs,
        maxAttempts: this.maxAttempts,
        error: message,
      });
      this.logger?.warn("work_signal.firing_process_failed", {
        firing_id: firing.firing_id,
        signal_id: firing.signal_id,
        error: message,
      });
    }
  }
}
