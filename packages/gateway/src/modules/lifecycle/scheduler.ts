import type { SqlDb } from "../../statestore/types.js";

export function readPositiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

export function resolvePositiveInt(
  explicit: number | undefined,
  envName: string,
  defaultValue: number,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return readPositiveIntFromEnv(envName) ?? defaultValue;
}

export async function tryAcquirePostgresXactLock(
  db: SqlDb,
  key1: number,
  key2: number,
): Promise<boolean> {
  const row = await db.get<{ locked: boolean }>(
    "SELECT pg_try_advisory_xact_lock(?, ?) AS locked",
    [key1, key2],
  );
  return row?.locked ?? false;
}

export async function pruneInBatches(
  opts: {
    batchSize: number;
    maxBatchesPerTick: number;
    onBudgetExhausted?: () => void;
  },
  pruneOnce: () => Promise<number>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < opts.maxBatchesPerTick; i += 1) {
    const changes = await pruneOnce();
    total += changes;
    if (changes < opts.batchSize) return total;
  }
  opts.onBudgetExhausted?.();
  return total;
}

export interface IntervalSchedulerOptions {
  tickMs: number;
  keepProcessAlive: boolean;
  onTickError: (error: unknown) => void;
  tick: () => Promise<void>;
}

export class IntervalScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(private readonly opts: IntervalSchedulerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.opts.onTickError(err));
    }, this.opts.tickMs);
    if (!this.opts.keepProcessAlive) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing — runs one tick cycle. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.opts.tick();
    } finally {
      this.ticking = false;
    }
  }
}
