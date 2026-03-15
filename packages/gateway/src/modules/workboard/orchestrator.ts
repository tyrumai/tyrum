import { randomUUID } from "node:crypto";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import { WorkboardDal } from "./dal.js";
import { SubagentService } from "./subagent-service.js";
import { buildPlannerInstruction, runManagedSubagentTurn } from "./orchestration-support.js";
import { isTerminalTaskState } from "./task-helpers.js";

const DEFAULT_TICK_MS = 1_000;

export class WorkboardOrchestrator {
  private readonly workboard: WorkboardDal;
  private readonly subagents: SubagentService;
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
    this.workboard = new WorkboardDal(opts.db);
    this.subagents = new SubagentService({ db: opts.db, agents: opts.agents });
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.orchestrator_tick_failed", { error: message });
      },
      tick: async () => {
        await this.tickOnce();
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

  private async tickOnce(): Promise<void> {
    const rows = await this.opts.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id, work_item_id
       FROM work_items
       WHERE status = 'backlog'
       ORDER BY created_at ASC
       LIMIT 25`,
    );
    for (const row of rows) {
      await this.processBacklogItem(
        {
          tenant_id: row.tenant_id,
          agent_id: row.agent_id,
          workspace_id: row.workspace_id,
        },
        row.work_item_id,
      );
    }

    await this.closePlannerSubagentsForNonBacklogItems();
  }

  private async processBacklogItem(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ): Promise<void> {
    const openClarifications = await this.workboard.listClarifications({
      scope,
      work_item_id: workItemId,
      statuses: ["open"],
      limit: 1,
    });
    const planner = await this.ensurePlannerSubagent(scope, workItemId);
    if (openClarifications.clarifications.length > 0) {
      if (planner.status !== "paused") {
        await this.workboard.updateSubagent({
          scope,
          subagent_id: planner.subagent_id,
          patch: { status: "paused" },
        });
      }
      return;
    }

    await this.ensurePlannerTask(scope, workItemId);

    const leaseOwner = `${this.opts.owner?.trim() || "workboard-orchestrator"}:${workItemId}`;
    const leased = await this.workboard.leaseRunnableTasks({
      scope,
      work_item_id: workItemId,
      lease_owner: leaseOwner,
      limit: 4,
    });
    const plannerTask = leased.leased.find((entry) => entry.task.execution_profile === "planner");
    for (const entry of leased.leased) {
      if (entry.task.execution_profile !== "planner") {
        await this.workboard.updateTask({
          scope,
          task_id: entry.task.task_id,
          lease_owner: leaseOwner,
          patch: { status: "queued" },
        });
      }
    }
    if (!plannerTask) {
      return;
    }

    await this.workboard.updateSubagent({
      scope,
      subagent_id: planner.subagent_id,
      patch: { status: "running" },
    });

    const item = await this.workboard.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      return;
    }

    const instruction = buildPlannerInstruction(item);
    try {
      const reply = await runManagedSubagentTurn({
        agents: this.opts.agents,
        db: this.opts.db,
        scope,
        subagent: planner,
        message: instruction,
      });
      await this.workboard.updateTask({
        scope,
        task_id: plannerTask.task.task_id,
        lease_owner: leaseOwner,
        patch: {
          status: "completed",
          finished_at: new Date().toISOString(),
          result_summary: reply || "Planner refinement turn completed.",
        },
      });
      const refreshed = await this.workboard.getItem({ scope, work_item_id: workItemId });
      if (refreshed?.status === "backlog") {
        await this.workboard.updateSubagent({
          scope,
          subagent_id: planner.subagent_id,
          patch: { status: "paused" },
        });
      } else {
        await this.workboard.markSubagentClosed({
          scope,
          subagent_id: planner.subagent_id,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.workboard.updateTask({
        scope,
        task_id: plannerTask.task.task_id,
        lease_owner: leaseOwner,
        patch: {
          status: "failed",
          finished_at: new Date().toISOString(),
          result_summary: message,
        },
      });
      await this.workboard.markSubagentFailed({
        scope,
        subagent_id: planner.subagent_id,
        reason: message,
      });
      this.opts.logger?.warn("workboard.planner_turn_failed", {
        work_item_id: workItemId,
        subagent_id: planner.subagent_id,
        error: message,
      });
    }
  }

  private async ensurePlannerTask(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ): Promise<void> {
    const tasks = await this.workboard.listTasks({ scope, work_item_id: workItemId });
    const plannerTasks = tasks.filter((task) => task.execution_profile === "planner");
    if (plannerTasks.some((task) => !isTerminalTaskState(task.status))) {
      return;
    }

    await this.workboard.createTask({
      scope,
      task: {
        work_item_id: workItemId,
        status: "queued",
        execution_profile: "planner",
        side_effect_class: "workspace",
        result_summary: "Planner refinement task",
      },
    });
  }

  private async ensurePlannerSubagent(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ) {
    const existing = await this.workboard.listSubagents({
      scope,
      work_item_id: workItemId,
      execution_profile: "planner",
      statuses: ["running", "paused"],
      limit: 5,
    });
    const active = existing.subagents.at(0);
    if (active) {
      return active;
    }

    const subagentId = randomUUID();
    const item = await this.workboard.getItem({
      scope,
      work_item_id: workItemId,
    });
    return await this.subagents.createSubagent({
      scope,
      subagentId,
      subagent: {
        parent_session_key: item?.created_from_session_key,
        work_item_id: workItemId,
        execution_profile: "planner",
        lane: "subagent",
        status: "paused",
      },
    });
  }

  private async closePlannerSubagentsForNonBacklogItems(): Promise<void> {
    const subagents = await this.opts.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      subagent_id: string;
      work_item_id: string;
      status: string;
      work_item_status: string;
    }>(
      `SELECT s.tenant_id, s.agent_id, s.workspace_id, s.subagent_id, s.work_item_id, s.status,
              i.status AS work_item_status
       FROM subagents s
       JOIN work_items i ON i.tenant_id = s.tenant_id AND i.work_item_id = s.work_item_id
       WHERE s.execution_profile = 'planner'
         AND s.status IN ('running', 'paused')
         AND i.status <> 'backlog'
       LIMIT 50`,
    );
    for (const subagent of subagents) {
      await this.workboard.markSubagentClosed({
        scope: {
          tenant_id: subagent.tenant_id,
          agent_id: subagent.agent_id,
          workspace_id: subagent.workspace_id,
        },
        subagent_id: subagent.subagent_id,
      });
    }
  }
}
