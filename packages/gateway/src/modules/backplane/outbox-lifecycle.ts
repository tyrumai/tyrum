import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import {
  IntervalScheduler,
  pruneInBatches,
  resolvePositiveInt,
  tryAcquirePostgresXactLock,
} from "../lifecycle/scheduler.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES_PER_TICK = 10;

const PG_COMPACTION_LOCK_KEY1 = 1959359839; // "tyru" as int-ish
const PG_COMPACTION_LOCK_KEY2 = 1868961640; // "obxc" as int-ish

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
  maxBatchesPerTick?: number;
  keepProcessAlive?: boolean;
  clock?: OutboxLifecycleSchedulerClockFn;
}

export class OutboxLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly retentionMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerTick: number;
  private readonly clock?: OutboxLifecycleSchedulerClockFn;
  private readonly interval: IntervalScheduler;

  constructor(opts: OutboxLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    const tickMs = resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS);
    this.retentionMs = resolvePositiveInt(opts.retentionMs, DEFAULT_RETENTION_MS);
    this.batchSize = Math.max(
      1,
      Math.min(1_000_000, resolvePositiveInt(opts.batchSize, DEFAULT_BATCH_SIZE)),
    );
    this.maxBatchesPerTick = Math.max(
      1,
      Math.min(1000, Math.floor(opts.maxBatchesPerTick ?? DEFAULT_MAX_BATCHES_PER_TICK)),
    );
    this.clock = opts.clock;
    const keepProcessAlive = opts.keepProcessAlive ?? false;
    this.interval = new IntervalScheduler({
      tickMs,
      keepProcessAlive,
      onTickError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.lifecycle_tick_failed", { error: message });
      },
      tick: () => this.tickOnce(),
    });
  }

  start(): void {
    this.interval.start();
  }

  stop(): void {
    this.interval.stop();
  }

  /** Exposed for testing — runs one retention/compaction cycle. */
  async tick(): Promise<void> {
    await this.interval.tick();
  }

  private async tickOnce(): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (tx.kind === "postgres") {
        const acquired = await tryAcquirePostgresXactLock(
          tx,
          PG_COMPACTION_LOCK_KEY1,
          PG_COMPACTION_LOCK_KEY2,
        );
        if (!acquired) return;
      }
      await this.runCompaction(tx);
    });
  }

  private async runCompaction(db: SqlDb): Promise<void> {
    if (this.clock) {
      const { nowMs } = this.clock();
      const cutoffIso = new Date(nowMs - this.retentionMs).toISOString();
      await this.pruneInBatches("outbox_consumers", () =>
        this.pruneOutboxConsumers(db, { cutoffIso }),
      );
      await this.pruneInBatches("outbox", () => this.pruneOutboxRows(db, { cutoffIso }));
      return;
    }

    await this.pruneInBatches("outbox_consumers", () =>
      this.pruneOutboxConsumers(db, { retentionMs: this.retentionMs }),
    );
    await this.pruneInBatches("outbox", () =>
      this.pruneOutboxRows(db, { retentionMs: this.retentionMs }),
    );
  }

  private async pruneInBatches(
    table: "outbox" | "outbox_consumers",
    pruneOnce: () => Promise<number>,
  ): Promise<void> {
    await pruneInBatches(
      {
        batchSize: this.batchSize,
        maxBatchesPerTick: this.maxBatchesPerTick,
        onBudgetExhausted: () => {
          this.logger?.warn("outbox.lifecycle_prune_budget_exhausted", {
            table,
            batch_size: this.batchSize,
            max_batches: this.maxBatchesPerTick,
          });
        },
      },
      pruneOnce,
    );
  }

  private async pruneOutboxConsumers(
    db: SqlDb,
    input: { cutoffIso: string } | { retentionMs: number },
  ): Promise<number> {
    if (db.kind === "sqlite") {
      const cutoff =
        "cutoffIso" in input
          ? { clause: "datetime(updated_at) < datetime(?)", params: [input.cutoffIso] }
          : {
              clause: "datetime(updated_at) < datetime('now', '-' || ? || ' seconds')",
              params: [Math.ceil(Math.max(1, input.retentionMs) / 1000)],
            };

      return (
        await db.run(
          `DELETE FROM outbox_consumers
         WHERE (tenant_id, consumer_id) IN (
           SELECT tenant_id, consumer_id
           FROM outbox_consumers
           WHERE ${cutoff.clause}
           ORDER BY datetime(updated_at) ASC
           LIMIT ?
         )`,
          [...cutoff.params, this.batchSize],
        )
      ).changes;
    }

    const clause =
      "cutoffIso" in input
        ? { clause: "updated_at < ?", params: [input.cutoffIso] }
        : {
            clause: "updated_at < now() - (? * interval '1 millisecond')",
            params: [input.retentionMs],
          };

    return (
      await db.run(
        `DELETE FROM outbox_consumers
       WHERE (tenant_id, consumer_id) IN (
         SELECT tenant_id, consumer_id
         FROM outbox_consumers
         WHERE ${clause.clause}
         ORDER BY updated_at ASC
         LIMIT ?
       )`,
        [...clause.params, this.batchSize],
      )
    ).changes;
  }

  private async pruneOutboxRows(
    db: SqlDb,
    input: { cutoffIso: string } | { retentionMs: number },
  ): Promise<number> {
    if (db.kind === "sqlite") {
      const cutoff =
        "cutoffIso" in input
          ? { clause: "datetime(created_at) < datetime(?)", params: [input.cutoffIso] }
          : {
              clause: "datetime(created_at) < datetime('now', '-' || ? || ' seconds')",
              params: [Math.ceil(Math.max(1, input.retentionMs) / 1000)],
            };

      return (
        await db.run(
          `DELETE FROM outbox
         WHERE id IN (
           SELECT id
           FROM outbox
           WHERE ${cutoff.clause}
           ORDER BY id ASC
           LIMIT ?
         )`,
          [...cutoff.params, this.batchSize],
        )
      ).changes;
    }

    const clause =
      "cutoffIso" in input
        ? { clause: "created_at < ?", params: [input.cutoffIso] }
        : {
            clause: "created_at < now() - (? * interval '1 millisecond')",
            params: [input.retentionMs],
          };

    return (
      await db.run(
        `DELETE FROM outbox
       WHERE id IN (
         SELECT id
         FROM outbox
         WHERE ${clause.clause}
         ORDER BY id ASC
         LIMIT ?
       )`,
        [...clause.params, this.batchSize],
      )
    ).changes;
  }
}
