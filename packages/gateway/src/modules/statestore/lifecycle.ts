import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";

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

function readPositiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function resolveTickMs(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(RETENTION_TICK_ENV) ?? DEFAULT_TICK_MS;
}

function resolveBatchSize(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(RETENTION_BATCH_ENV) ?? DEFAULT_BATCH_SIZE;
}

function resolveSessionsTtlDays(): number {
  const raw = process.env[SESSIONS_TTL_ENV]?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_SESSIONS_TTL_DAYS;
}

export class StateStoreLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly batchSize: number;
  private readonly maxBatchesPerTick: number;
  private readonly keepProcessAlive: boolean;
  private readonly clock: StateStoreLifecycleSchedulerClockFn;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: StateStoreLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.tickMs = resolveTickMs(opts.tickMs);
    this.batchSize = Math.max(1, Math.min(1_000_000, resolveBatchSize(opts.batchSize)));
    this.maxBatchesPerTick = Math.max(
      1,
      Math.min(1000, Math.floor(opts.maxBatchesPerTick ?? DEFAULT_MAX_BATCHES_PER_TICK)),
    );
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.clock = opts.clock ?? defaultClock;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("statestore.lifecycle_tick_failed", { error: message });
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

  /** Exposed for testing — runs one retention/TTL-prune cycle. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.db.transaction(async (tx) => {
        if (tx.kind === "postgres") {
          const acquired = await this.tryAcquirePostgresLock(tx);
          if (!acquired) return;
        }
        await this.runOnce(tx);
      });
    } finally {
      this.ticking = false;
    }
  }

  private async tryAcquirePostgresLock(db: SqlDb): Promise<boolean> {
    const row = await db.get<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(?, ?) AS locked",
      [PG_RETENTION_LOCK_KEY1, PG_RETENTION_LOCK_KEY2],
    );
    return row?.locked ?? false;
  }

  private async runOnce(db: SqlDb): Promise<void> {
    const { nowMs } = this.clock();
    const sessionsTtlDays = resolveSessionsTtlDays();
    const sessionsCutoffIso = new Date(nowMs - sessionsTtlDays * 24 * 60 * 60 * 1000).toISOString();

    await this.pruneInBatches("sessions", () => this.pruneExpiredSessions(db, { cutoffIso: sessionsCutoffIso }));
    await this.pruneInBatches(
      "presence_entries",
      () => this.pruneExpiredByMsColumn(db, { table: "presence_entries", pk: "instance_id", nowMs }),
    );
    await this.pruneInBatches(
      "connection_directory",
      () => this.pruneExpiredByMsColumn(db, { table: "connection_directory", pk: "connection_id", nowMs }),
    );
    await this.pruneInBatches(
      "channel_inbound_dedupe",
      () => this.pruneExpiredInboundDedupe(db, { nowMs }),
    );
  }

  private async pruneInBatches(
    name: string,
    pruneOnce: () => Promise<number>,
  ): Promise<void> {
    for (let i = 0; i < this.maxBatchesPerTick; i += 1) {
      const changes = await pruneOnce();
      if (changes < this.batchSize) return;
    }
    this.logger?.warn("statestore.lifecycle_prune_budget_exhausted", {
      task: name,
      batch_size: this.batchSize,
      max_batches: this.maxBatchesPerTick,
    });
  }

  private async pruneExpiredSessions(db: SqlDb, input: { cutoffIso: string }): Promise<number> {
    const selectSql =
      db.kind === "sqlite"
        ? `SELECT session_id
           FROM sessions
           WHERE datetime(updated_at) < datetime(?)
           ORDER BY datetime(updated_at) ASC
           LIMIT ?`
        : `SELECT session_id
           FROM sessions
           WHERE updated_at < ?
           ORDER BY updated_at ASC
           LIMIT ?`;

    const rows = await db.all<{ session_id: string }>(selectSql, [input.cutoffIso, this.batchSize]);
    const sessionIds = rows
      .map((r) => r.session_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (sessionIds.length === 0) return 0;

    const placeholders = sessionIds.map(() => "?").join(", ");
    await db.run(
      `DELETE FROM session_provider_pins
       WHERE session_id IN (${placeholders})`,
      sessionIds,
    );
    await db.run(
      `DELETE FROM context_reports
       WHERE session_id IN (${placeholders})`,
      sessionIds,
    );
    return (await db.run(
      `DELETE FROM sessions
       WHERE session_id IN (${placeholders})`,
      sessionIds,
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

