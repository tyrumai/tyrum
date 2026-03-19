import { WorkboardReconciler as RuntimeWorkboardReconciler } from "@tyrum/runtime-workboard";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { createGatewayWorkboardRepository } from "./runtime-workboard-adapters.js";

const DEFAULT_TICK_MS = 2_000;

export class WorkboardReconciler {
  private readonly reconciler: RuntimeWorkboardReconciler;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      logger?: Logger;
      tickMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.reconciler = new RuntimeWorkboardReconciler({
      repository: createGatewayWorkboardRepository(opts.db),
    });
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.reconciler_tick_failed", { error: message });
      },
      tick: async () => {
        await this.reconciler.tick();
      },
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  async tick(): Promise<void> {
    await this.scheduler.tick();
  }
}
