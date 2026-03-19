import { WorkboardOrchestrator as RuntimeWorkboardOrchestrator } from "@tyrum/runtime-workboard";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import {
  createGatewaySubagentRuntime,
  createGatewayWorkboardRepository,
} from "./runtime-workboard-adapters.js";

const DEFAULT_TICK_MS = 1_000;

export class WorkboardOrchestrator {
  private readonly orchestrator: RuntimeWorkboardOrchestrator;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      agents: AgentRegistry;
      owner?: string;
      logger?: Logger;
      tickMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.orchestrator = new RuntimeWorkboardOrchestrator({
      repository: createGatewayWorkboardRepository(opts.db),
      runtime: createGatewaySubagentRuntime({ db: opts.db, agents: opts.agents }),
      owner: opts.owner,
      logger: opts.logger,
    });
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.orchestrator_tick_failed", { error: message });
      },
      tick: async () => {
        await this.orchestrator.tick();
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
