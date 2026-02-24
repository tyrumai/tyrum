import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_BATCH_SIZE = 10_000;

const OUTBOX_RETENTION_ENV = "TYRUM_OUTBOX_RETENTION_MS";
const OUTBOX_TICK_ENV = "TYRUM_OUTBOX_COMPACTION_TICK_MS";
const OUTBOX_BATCH_ENV = "TYRUM_OUTBOX_COMPACTION_BATCH_SIZE";

export interface OutboxLifecycleSchedulerClock {
  nowMs: number;
  nowIso: string;
}

export type OutboxLifecycleSchedulerClockFn = () => OutboxLifecycleSchedulerClock;

export interface OutboxLifecycleSchedulerOptions {
  db: SqlDb;
  logger?: Logger;
  retentionMs?: number;
  tickMs?: number;
  batchSize?: number;
  keepProcessAlive?: boolean;
  clock?: OutboxLifecycleSchedulerClockFn;
}

function readPositiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function resolveRetentionMs(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(OUTBOX_RETENTION_ENV) ?? DEFAULT_RETENTION_MS;
}

function resolveTickMs(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(OUTBOX_TICK_ENV) ?? DEFAULT_TICK_MS;
}

function resolveBatchSize(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(OUTBOX_BATCH_ENV) ?? DEFAULT_BATCH_SIZE;
}

export class OutboxLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly retentionMs: number;
  private readonly batchSize: number;
  private readonly keepProcessAlive: boolean;
  private readonly clock?: OutboxLifecycleSchedulerClockFn;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: OutboxLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.tickMs = resolveTickMs(opts.tickMs);
    this.retentionMs = resolveRetentionMs(opts.retentionMs);
    this.batchSize = Math.max(1, Math.min(1_000_000, resolveBatchSize(opts.batchSize)));
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.clock = opts.clock;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.lifecycle_tick_failed", { error: message });
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

  /** Exposed for testing — runs one retention/compaction cycle. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.clock) {
        const { nowMs } = this.clock();
        const cutoffIso = new Date(nowMs - this.retentionMs).toISOString();
        await this.pruneOutboxConsumers({ cutoffIso });
        await this.pruneOutboxRows({ cutoffIso });
        return;
      }

      await this.pruneOutboxConsumers({ retentionMs: this.retentionMs });
      await this.pruneOutboxRows({ retentionMs: this.retentionMs });
    } finally {
      this.ticking = false;
    }
  }

  private async pruneOutboxConsumers(input: { cutoffIso: string } | { retentionMs: number }): Promise<number> {
    if (this.db.kind === "sqlite") {
      const cutoff = "cutoffIso" in input
        ? { clause: "datetime(updated_at) < datetime(?)", params: [input.cutoffIso] }
        : {
            clause: "datetime(updated_at) < datetime('now', '-' || ? || ' seconds')",
            params: [Math.ceil(Math.max(1, input.retentionMs) / 1000)],
          };

      return (await this.db.run(
        `DELETE FROM outbox_consumers
         WHERE consumer_id IN (
           SELECT consumer_id
           FROM outbox_consumers
           WHERE ${cutoff.clause}
           ORDER BY datetime(updated_at) ASC
           LIMIT ?
         )`,
        [...cutoff.params, this.batchSize],
      )).changes;
    }

    const clause = "cutoffIso" in input
      ? { clause: "updated_at < ?", params: [input.cutoffIso] }
      : { clause: "updated_at < now() - (? * interval '1 millisecond')", params: [input.retentionMs] };

    return (await this.db.run(
      `DELETE FROM outbox_consumers
       WHERE consumer_id IN (
         SELECT consumer_id
         FROM outbox_consumers
         WHERE ${clause.clause}
         ORDER BY updated_at ASC
         LIMIT ?
       )`,
      [...clause.params, this.batchSize],
    )).changes;
  }

  private async pruneOutboxRows(input: { cutoffIso: string } | { retentionMs: number }): Promise<number> {
    if (this.db.kind === "sqlite") {
      const cutoff = "cutoffIso" in input
        ? { clause: "datetime(created_at) < datetime(?)", params: [input.cutoffIso] }
        : {
            clause: "datetime(created_at) < datetime('now', '-' || ? || ' seconds')",
            params: [Math.ceil(Math.max(1, input.retentionMs) / 1000)],
          };

      return (await this.db.run(
        `DELETE FROM outbox
         WHERE id IN (
           SELECT id
           FROM outbox
           WHERE ${cutoff.clause}
           ORDER BY id ASC
           LIMIT ?
         )`,
        [...cutoff.params, this.batchSize],
      )).changes;
    }

    const clause = "cutoffIso" in input
      ? { clause: "created_at < ?", params: [input.cutoffIso] }
      : { clause: "created_at < now() - (? * interval '1 millisecond')", params: [input.retentionMs] };

    return (await this.db.run(
      `DELETE FROM outbox
       WHERE id IN (
         SELECT id
         FROM outbox
         WHERE ${clause.clause}
         ORDER BY id ASC
         LIMIT ?
       )`,
      [...clause.params, this.batchSize],
    )).changes;
  }
}
