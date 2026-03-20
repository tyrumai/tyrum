import { WorkboardReconciler as RuntimeWorkboardReconciler } from "@tyrum/runtime-workboard";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { createGatewayWorkboardRepository } from "./runtime-workboard-adapters.js";

const DEFAULT_TICK_MS = 2_000;

export class WorkboardReconciler {
  private readonly reconciler: RuntimeWorkboardReconciler;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      redactionEngine?: RedactionEngine;
      approvalDal?: ApprovalDal;
      policyService?: PolicyService;
      protocolDeps?: ProtocolDeps;
      logger?: Logger;
      tickMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.reconciler = new RuntimeWorkboardReconciler({
      repository: createGatewayWorkboardRepository({
        db: opts.db,
        redactionEngine: opts.redactionEngine,
        approvalDal: opts.approvalDal,
        policyService: opts.policyService,
        protocolDeps: opts.protocolDeps,
      }),
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
