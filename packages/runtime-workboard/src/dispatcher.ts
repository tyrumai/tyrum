import { randomUUID } from "node:crypto";
import type { WorkScope } from "@tyrum/contracts";
import { buildExecutorInstruction, maybeFinalizeWorkItem } from "./orchestration-support.js";
import { SubagentService } from "./subagent-service.js";
import { isTerminalTaskState } from "./task-helpers.js";
import type {
  ManagedDesktopProvisioner,
  WorkboardDispatcherRepository,
  WorkboardLogger,
  WorkboardSubagentRuntime,
} from "./types.js";

export class WorkboardDispatcher {
  private readonly subagents: SubagentService;

  constructor(
    private readonly opts: {
      repository: WorkboardDispatcherRepository;
      runtime: WorkboardSubagentRuntime;
      desktopProvisioner?: ManagedDesktopProvisioner;
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
    const rows = await this.opts.repository.listReadyItems(10);
    for (const row of rows) {
      const dispatched = await this.tryDispatchItem(row, row.work_item_id);
      if (dispatched) {
        return;
      }
    }
  }

  private async tryDispatchItem(scope: WorkScope, workItemId: string): Promise<boolean> {
    const item = await this.opts.repository.getItem({ scope, work_item_id: workItemId });
    if (!item || item.status !== "ready") {
      return false;
    }

    await this.ensureExecutionTask(scope, workItemId);

    const leaseOwner = `${this.opts.owner?.trim() || "workboard-dispatcher"}:${workItemId}`;
    const leased = await this.opts.repository.leaseRunnableTasks({
      scope,
      work_item_id: workItemId,
      lease_owner: leaseOwner,
      limit: 4,
    });
    const executionTask = leased.leased.find((entry) => entry.task.execution_profile !== "planner");
    for (const entry of leased.leased) {
      if (executionTask && entry.task.task_id === executionTask.task.task_id) {
        continue;
      }
      await this.opts.repository.updateTask({
        scope,
        task_id: entry.task.task_id,
        lease_owner: leaseOwner,
        patch: { status: "queued" },
      });
    }
    if (!executionTask) {
      return false;
    }

    try {
      await this.opts.repository.transitionItem({
        scope,
        work_item_id: workItemId,
        status: "doing",
        reason: "Auto-dispatched to executor.",
      });
    } catch {
      await this.opts.repository.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        lease_owner: leaseOwner,
        patch: { status: "queued" },
      });
      return false;
    }

    const subagentId = randomUUID();
    const sessionKey = await this.opts.runtime.buildSessionKey(scope, subagentId);
    const needsDesktop =
      (
        await this.opts.repository.getStateKv({
          scope: { kind: "work_item", ...scope, work_item_id: workItemId },
          key: "work.execution.needs_desktop",
        })
      )?.value_json === true;

    const attachment =
      needsDesktop && this.opts.desktopProvisioner
        ? await this.opts.desktopProvisioner.provisionManagedDesktop({
            tenantId: scope.tenant_id,
            subagentSessionKey: sessionKey,
            subagentLane: "subagent",
            label: `executor:${workItemId}`,
          })
        : undefined;

    const subagent = await this.subagents.createSubagent({
      scope,
      subagentId,
      subagent: {
        parent_session_key: item.created_from_session_key,
        work_item_id: workItemId,
        work_item_task_id: executionTask.task.task_id,
        execution_profile:
          executionTask.task.execution_profile === "integrator"
            ? "executor_rw"
            : executionTask.task.execution_profile,
        session_key: sessionKey,
        lane: "subagent",
        status: "running",
        desktop_environment_id: attachment?.desktopEnvironmentId,
        attached_node_id: attachment?.attachedNodeId,
      },
    });

    await this.opts.repository.updateTask({
      scope,
      task_id: executionTask.task.task_id,
      lease_owner: leaseOwner,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
      },
    });

    try {
      const reply = await this.opts.runtime.runTurn({
        scope,
        subagent,
        message: buildExecutorInstruction({
          item,
          task: executionTask.task,
          attachedNodeId: attachment?.attachedNodeId,
        }),
      });
      await this.opts.repository.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        patch: {
          status: "completed",
          finished_at: new Date().toISOString(),
          result_summary: reply || "Executor task completed.",
        },
      });
      await this.opts.repository.markSubagentClosed({
        scope,
        subagent_id: subagent.subagent_id,
      });
      await maybeFinalizeWorkItem({
        repository: this.opts.repository,
        scope,
        workItemId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.opts.repository.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        patch: {
          status: "failed",
          finished_at: new Date().toISOString(),
          result_summary: message,
        },
      });
      await this.opts.repository.markSubagentFailed({
        scope,
        subagent_id: subagent.subagent_id,
        reason: message,
      });
      await this.opts.repository
        .transitionItem({
          scope,
          work_item_id: workItemId,
          status: "blocked",
          reason: message,
        })
        .catch(() => undefined);
      this.opts.logger?.warn("workboard.executor_turn_failed", {
        work_item_id: workItemId,
        task_id: executionTask.task.task_id,
        subagent_id: subagent.subagent_id,
        error: message,
      });
    }

    return true;
  }

  private async ensureExecutionTask(scope: WorkScope, workItemId: string): Promise<void> {
    const tasks = await this.opts.repository.listTasks({ scope, work_item_id: workItemId });
    const executionTasks = tasks.filter((task) => task.execution_profile !== "planner");
    if (executionTasks.some((task) => !isTerminalTaskState(task.status))) {
      return;
    }

    const hasSuccessfulExecutionTask = executionTasks.some(
      (task) => task.status === "completed" || task.status === "skipped",
    );
    if (executionTasks.length > 0 && hasSuccessfulExecutionTask) {
      return;
    }

    await this.opts.repository.createTask({
      scope,
      task: {
        work_item_id: workItemId,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
        result_summary: "Default execution task",
      },
    });
  }
}
