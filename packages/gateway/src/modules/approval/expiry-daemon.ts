/**
 * Background daemon that periodically expires stale approval requests.
 *
 * Converts any pending approval whose `expires_at` has passed to status='expired'.
 * This ensures approvals are deterministically expired even when no polling
 * client is active.
 */

import type { ApprovalDal } from "./dal.js";

export interface ExpiryDaemonOpts {
  approvalDal: ApprovalDal;
  intervalMs?: number;
}

export class ApprovalExpiryDaemon {
  private readonly approvalDal: ApprovalDal;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: ExpiryDaemonOpts) {
    this.approvalDal = opts.approvalDal;
    this.intervalMs = opts.intervalMs ?? 30_000; // default 30s
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

  async tick(): Promise<number> {
    return await this.approvalDal.expireStale();
  }
}
