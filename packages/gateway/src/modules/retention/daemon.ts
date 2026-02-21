/**
 * Background daemon that periodically prunes old rows according
 * to retention policies.
 *
 * Follows the ApprovalExpiryDaemon pattern: constructor-injected
 * config + db, configurable interval, start/stop/tick.
 */

import type { SqlDb } from "../../statestore/types.js";
import type { RetentionPolicy } from "./config.js";
import { DEFAULT_POLICIES } from "./config.js";
import { pruneByAge, pruneByCount } from "./dal.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface RetentionDaemonOpts {
  db: SqlDb;
  policies?: RetentionPolicy[];
  intervalMs?: number;
}

export class RetentionDaemon {
  private readonly db: SqlDb;
  private readonly policies: RetentionPolicy[];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: RetentionDaemonOpts) {
    this.db = opts.db;
    this.policies = opts.policies ?? DEFAULT_POLICIES;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one retention cycle. Returns total rows deleted. */
  async tick(): Promise<number> {
    let total = 0;

    for (const policy of this.policies) {
      if (policy.maxAgeDays != null && policy.maxAgeDays > 0) {
        const cutoff = new Date(
          Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        total += await pruneByAge(this.db, policy.table, policy.timestampColumn, cutoff);
      }

      if (policy.maxCount != null && policy.maxCount > 0) {
        total += await pruneByCount(this.db, policy.table, policy.maxCount, policy.timestampColumn);
      }
    }

    return total;
  }
}
