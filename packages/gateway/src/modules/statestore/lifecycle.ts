import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import {
  IntervalScheduler,
  pruneInBatches,
  resolvePositiveInt,
  tryAcquirePostgresXactLock,
} from "../lifecycle/scheduler.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES_PER_TICK = 10;
const DEFAULT_SESSIONS_TTL_DAYS = 30;

const RETENTION_TICK_ENV = "TYRUM_STATESTORE_RETENTION_TICK_MS";
const RETENTION_BATCH_ENV = "TYRUM_STATESTORE_RETENTION_BATCH_SIZE";
const SESSIONS_TTL_ENV = "TYRUM_SESSIONS_TTL_DAYS";

const PG_RETENTION_LOCK_KEY1 = 1959359839; // "tyru" as int-ish
const PG_RETENTION_LOCK_KEY2 = 1936024435; // "stlr" as int-ish

export interface StateStoreLifecycleSchedulerClock {
  nowMs: number;
  nowIso: string;
}

export type StateStoreLifecycleSchedulerClockFn = () => StateStoreLifecycleSchedulerClock;

export interface StateStoreLifecycleSchedulerOptions {
  db: SqlDb;
  logger?: Logger;
  tickMs?: number;
  batchSize?: number;
  maxBatchesPerTick?: number;
  keepProcessAlive?: boolean;
  clock?: StateStoreLifecycleSchedulerClockFn;
}

function defaultClock(): StateStoreLifecycleSchedulerClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}

function resolveSessionsTtlDays(): number {
  const raw = process.env[SESSIONS_TTL_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return DEFAULT_SESSIONS_TTL_DAYS;
}

export class StateStoreLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly batchSize: number;
  private readonly maxBatchesPerTick: number;
  private readonly clock: StateStoreLifecycleSchedulerClockFn;
  private readonly interval: IntervalScheduler;

  constructor(opts: StateStoreLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    const tickMs = resolvePositiveInt(opts.tickMs, RETENTION_TICK_ENV, DEFAULT_TICK_MS);
    this.batchSize = Math.max(
      1,
      Math.min(1_000_000, resolvePositiveInt(opts.batchSize, RETENTION_BATCH_ENV, DEFAULT_BATCH_SIZE)),
    );
    this.maxBatchesPerTick = Math.max(
      1,
      Math.min(1000, Math.floor(opts.maxBatchesPerTick ?? DEFAULT_MAX_BATCHES_PER_TICK)),
    );
    this.clock = opts.clock ?? defaultClock;
    const keepProcessAlive = opts.keepProcessAlive ?? false;
    this.interval = new IntervalScheduler({
      tickMs,
      keepProcessAlive,
      onTickError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("statestore.lifecycle_tick_failed", { error: message });
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

  /** Exposed for testing — runs one retention/TTL-prune cycle. */
  async tick(): Promise<void> {
    await this.interval.tick();
  }

  private async tickOnce(): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (tx.kind === "postgres") {
        const acquired = await tryAcquirePostgresXactLock(tx, PG_RETENTION_LOCK_KEY1, PG_RETENTION_LOCK_KEY2);
        if (!acquired) return;
      }
      await this.runOnce(tx);
    });
  }

  private async runOnce(db: SqlDb): Promise<void> {
    const { nowMs, nowIso } = this.clock();
    const sessionsTtlDays = resolveSessionsTtlDays();
    const sessionsCutoffIso = new Date(nowMs - sessionsTtlDays * 24 * 60 * 60 * 1000).toISOString();

    const sessionsPruned = await this.pruneInBatches(
      "sessions",
      () => this.pruneExpiredSessions(db, { cutoffIso: sessionsCutoffIso }),
    );
    const presencePruned = await this.pruneInBatches(
      "presence_entries",
      () => this.pruneExpiredByMsColumn(db, { table: "presence_entries", pk: "instance_id", nowMs }),
    );
    const directoryPruned = await this.pruneInBatches(
      "connection_directory",
      () => this.pruneExpiredByMsColumn(db, { table: "connection_directory", pk: "connection_id", nowMs }),
    );
    const dedupePruned = await this.pruneInBatches(
      "channel_inbound_dedupe",
      () => this.pruneExpiredInboundDedupe(db, { nowMs }),
    );

    if (sessionsPruned + presencePruned + directoryPruned + dedupePruned > 0) {
      this.logger?.info("statestore.lifecycle_pruned", {
        now: nowIso,
        sessions: sessionsPruned,
        presence_entries: presencePruned,
        connection_directory: directoryPruned,
        channel_inbound_dedupe: dedupePruned,
      });
    }
  }

  private async pruneInBatches(
    name: string,
    pruneOnce: () => Promise<number>,
  ): Promise<number> {
    return await pruneInBatches(
      {
        batchSize: this.batchSize,
        maxBatchesPerTick: this.maxBatchesPerTick,
        onBudgetExhausted: () => {
          this.logger?.warn("statestore.lifecycle_prune_budget_exhausted", {
            task: name,
            batch_size: this.batchSize,
            max_batches: this.maxBatchesPerTick,
          });
        },
      },
      pruneOnce,
    );
  }

  private async pruneExpiredSessions(db: SqlDb, input: { cutoffIso: string }): Promise<number> {
    const sessionCutoff = {
      clause: "updated_at < ?",
      order: "updated_at ASC, session_id ASC",
      params: [input.cutoffIso],
    };

    const batch = [...sessionCutoff.params, this.batchSize];

    await db.run(
      `DELETE FROM session_model_overrides
       WHERE session_id IN (
         SELECT session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    await db.run(
      `DELETE FROM session_provider_pins
       WHERE session_id IN (
         SELECT session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    await db.run(
      `DELETE FROM context_reports
       WHERE session_id IN (
         SELECT session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    return (await db.run(
      `DELETE FROM sessions
       WHERE session_id IN (
         SELECT session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    )).changes;
  }

  private async pruneExpiredByMsColumn(
    db: SqlDb,
    input: {
      table: "presence_entries" | "connection_directory";
      pk: "instance_id" | "connection_id";
      nowMs: number;
    },
  ): Promise<number> {
    return (await db.run(
      `DELETE FROM ${input.table}
       WHERE ${input.pk} IN (
         SELECT ${input.pk}
         FROM ${input.table}
         WHERE expires_at_ms <= ?
         ORDER BY expires_at_ms ASC
         LIMIT ?
       )`,
      [input.nowMs, this.batchSize],
    )).changes;
  }

  private async pruneExpiredInboundDedupe(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (await db.run(
      `DELETE FROM channel_inbound_dedupe
       WHERE (channel, account_id, container_id, message_id) IN (
         SELECT channel, account_id, container_id, message_id
         FROM channel_inbound_dedupe
         WHERE expires_at_ms <= ?
         ORDER BY expires_at_ms ASC
         LIMIT ?
       )`,
      [input.nowMs, this.batchSize],
    )).changes;
  }
}
