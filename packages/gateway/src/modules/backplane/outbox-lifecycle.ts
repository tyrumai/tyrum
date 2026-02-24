import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60_000;

const OUTBOX_RETENTION_ENV = "TYRUM_OUTBOX_RETENTION_MS";
const OUTBOX_TICK_ENV = "TYRUM_OUTBOX_COMPACTION_TICK_MS";

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
  keepProcessAlive?: boolean;
  clock?: OutboxLifecycleSchedulerClockFn;
}

function defaultClock(): OutboxLifecycleSchedulerClock {
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

export class OutboxLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly retentionMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly clock: OutboxLifecycleSchedulerClockFn;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: OutboxLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.tickMs = resolveTickMs(opts.tickMs);
    this.retentionMs = resolveRetentionMs(opts.retentionMs);
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.clock = opts.clock ?? defaultClock;
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
    const { nowMs } = this.clock();
    const cutoffIso = new Date(nowMs - this.retentionMs).toISOString();
    await this.pruneOutboxConsumers(cutoffIso);
    await this.pruneOutboxRows(cutoffIso);
  }

  private async pruneOutboxConsumers(cutoffIso: string): Promise<number> {
    if (this.db.kind === "sqlite") {
      return (await this.db.run(
        "DELETE FROM outbox_consumers WHERE datetime(updated_at) < datetime(?)",
        [cutoffIso],
      )).changes;
    }

    return (await this.db.run(
      "DELETE FROM outbox_consumers WHERE updated_at < ?",
      [cutoffIso],
    )).changes;
  }

  private async pruneOutboxRows(cutoffIso: string): Promise<number> {
    if (this.db.kind === "sqlite") {
      return (await this.db.run(
        "DELETE FROM outbox WHERE datetime(created_at) < datetime(?)",
        [cutoffIso],
      )).changes;
    }

    return (await this.db.run(
      "DELETE FROM outbox WHERE created_at < ?",
      [cutoffIso],
    )).changes;
  }
}

