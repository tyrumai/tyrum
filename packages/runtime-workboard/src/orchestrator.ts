import type { WorkScope } from "@tyrum/contracts";
import { buildPlannerInstruction } from "./orchestration-support.js";
import { SubagentService } from "./subagent-service.js";
import { isTerminalTaskState } from "./task-helpers.js";
import type {
  WorkboardLogger,
  WorkboardOrchestratorRepository,
  WorkboardSubagentRuntime,
} from "./types.js";

function isInterruptError(error: unknown): boolean {
  return error instanceof Error && error.name === "LaneQueueInterruptError";
}

export class WorkboardOrchestrator {
  private readonly subagents: SubagentService;

  constructor(
    private readonly opts: {
      repository: WorkboardOrchestratorRepository;
      runtime: WorkboardSubagentRuntime;
      owner?: string;
      logger?: WorkboardLogger;
    },
  ) {
    this.subagents = new SubagentService({
      repository: opts.repository,
      runtime: opts.runtime,
    });
  }

  async tick(): Promise<void> {
    const rows = await this.opts.repository.listBacklogItems(25);
    for (const row of rows) {
      await this.processBacklogItem(row, row.work_item_id);
    }

    await this.closePlannerSubagentsForNonBacklogItems();
  }

  private async processBacklogItem(scope: WorkScope, workItemId: string): Promise<void> {
    const openClarifications = await this.opts.repository.listClarifications({
      scope,
      work_item_id: workItemId,
      statuses: ["open"],
      limit: 1,
    });
    const planner = await this.ensurePlannerSubagent(scope, workItemId);
    if (openClarifications.clarifications.length > 0) {
      if (planner.status !== "paused") {
        await this.opts.repository.updateSubagent({
          scope,
          subagent_id: planner.subagent_id,
          patch: { status: "paused" },
        });
      }
      return;
    }

    await this.ensurePlannerTask(scope, workItemId);

    const leaseOwner = `${this.opts.owner?.trim() || "workboard-orchestrator"}:${workItemId}`;
    const leased = await this.opts.repository.leaseRunnableTasks({
      scope,
      work_item_id: workItemId,
      lease_owner: leaseOwner,
      limit: 4,
    });
    const plannerTask = leased.leased.find((entry) => entry.task.execution_profile === "planner");
    for (const entry of leased.leased) {
      if (entry.task.execution_profile !== "planner") {
        await this.opts.repository.updateTask({
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

    await this.opts.repository.updateSubagent({
      scope,
      subagent_id: planner.subagent_id,
      patch: { status: "running" },
    });
    await this.opts.repository.updateTask({
      scope,
      task_id: plannerTask.task.task_id,
      lease_owner: leaseOwner,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
        subagent_id: planner.subagent_id,
      },
    });
    await this.opts.repository.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: workItemId },
      key: "work.refinement.phase",
      value_json: "refining",
      provenance_json: { source: "workboard.orchestrator" },
    });

    const item = await this.opts.repository.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      return;
    }

    const instruction = buildPlannerInstruction(item);
    try {
      const reply = await this.opts.runtime.runTurn({
        scope,
        subagent: planner,
        message: instruction,
      });
      await this.opts.repository.updateTask({
        scope,
        task_id: plannerTask.task.task_id,
        lease_owner: leaseOwner,
        patch: {
          status: "completed",
          finished_at: new Date().toISOString(),
          result_summary: reply || "Planner refinement turn completed.",
        },
      });
      const refreshed = await this.opts.repository.getItem({ scope, work_item_id: workItemId });
      if (refreshed?.status === "backlog") {
        await this.opts.repository.updateSubagent({
          scope,
          subagent_id: planner.subagent_id,
          patch: { status: "paused" },
        });
      } else {
        await this.opts.repository.setStateKv({
          scope: { kind: "work_item", ...scope, work_item_id: workItemId },
          key: "work.refinement.phase",
          value_json: "done",
          provenance_json: { source: "workboard.orchestrator" },
        });
        await this.opts.repository.markSubagentClosed({
          scope,
          subagent_id: planner.subagent_id,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isInterruptError(error)) {
        const currentTasks = await this.opts.repository.listTasks({
          scope,
          work_item_id: workItemId,
        });
        const currentPlannerTask = currentTasks.find(
          (task) => task.task_id === plannerTask.task.task_id,
        );
        if (currentPlannerTask?.status === "paused" || currentPlannerTask?.status === "cancelled") {
          return;
        }
        await this.opts.repository.updateTask({
          scope,
          task_id: plannerTask.task.task_id,
          patch: {
            status: "paused",
            approval_id: null,
            pause_reason: "manual",
            pause_detail: message,
            result_summary: message,
          },
        });
        await this.opts.repository.updateSubagent({
          scope,
          subagent_id: planner.subagent_id,
          patch: { status: "paused" },
        });
        await this.opts.repository.setStateKv({
          scope: { kind: "work_item", ...scope, work_item_id: workItemId },
          key: "work.refinement.phase",
          value_json: "awaiting_human",
          provenance_json: { source: "workboard.orchestrator" },
        });
        return;
      }
      await this.opts.repository.updateTask({
        scope,
        task_id: plannerTask.task.task_id,
        lease_owner: leaseOwner,
        patch: {
          status: "failed",
          finished_at: new Date().toISOString(),
          result_summary: message,
        },
      });
      await this.opts.repository.markSubagentFailed({
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

  private async ensurePlannerTask(scope: WorkScope, workItemId: string): Promise<void> {
    const tasks = await this.opts.repository.listTasks({ scope, work_item_id: workItemId });
    const plannerTasks = tasks.filter((task) => task.execution_profile === "planner");
    if (plannerTasks.some((task) => !isTerminalTaskState(task.status))) {
      return;
    }

    await this.opts.repository.createTask({
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

  private async ensurePlannerSubagent(scope: WorkScope, workItemId: string) {
    const existing = await this.opts.repository.listSubagents({
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

    const item = await this.opts.repository.getItem({
      scope,
      work_item_id: workItemId,
    });
    return await this.subagents.createSubagent({
      scope,
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
    const subagents = await this.opts.repository.listPlannerSubagentsOutsideBacklog(50);
    for (const subagent of subagents) {
      await this.opts.repository.markSubagentClosed({
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
