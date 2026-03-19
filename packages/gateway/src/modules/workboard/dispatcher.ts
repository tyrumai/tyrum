import { WorkboardDispatcher as RuntimeWorkboardDispatcher } from "@tyrum/runtime-workboard";
import type { DeploymentConfig as DeploymentConfigT } from "@tyrum/contracts";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import {
  createGatewayManagedDesktopProvisioner,
  createGatewaySubagentRuntime,
  createGatewayWorkboardRepository,
} from "./runtime-workboard-adapters.js";

const DEFAULT_TICK_MS = 1_000;

export class WorkboardDispatcher {
  private readonly dispatcher: RuntimeWorkboardDispatcher;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      agents: AgentRegistry;
      sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
      defaultDeploymentConfig: DeploymentConfigT;
      owner?: string;
      logger?: Logger;
      tickMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.dispatcher = new RuntimeWorkboardDispatcher({
      repository: createGatewayWorkboardRepository(opts.db),
      runtime: createGatewaySubagentRuntime({ db: opts.db, agents: opts.agents }),
      desktopProvisioner: createGatewayManagedDesktopProvisioner({
        db: opts.db,
        sessionLaneNodeAttachmentDal: opts.sessionLaneNodeAttachmentDal,
        defaultDeploymentConfig: opts.defaultDeploymentConfig,
      }),
      owner: opts.owner,
      logger: opts.logger,
    });
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.dispatcher_tick_failed", { error: message });
      },
      tick: async () => {
        await this.dispatcher.tick();
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
