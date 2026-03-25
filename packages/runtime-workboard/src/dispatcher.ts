import type { WorkItemTask, WorkScope } from "@tyrum/contracts";
import { buildExecutorInstruction } from "./orchestration-support.js";
import {
  ensureExecutionTask,
  prepareExecutionSubagent,
  reconcileItemDispatchState,
  requeueLeasedTask,
} from "./dispatcher-support.js";
import { SubagentService } from "./subagent-service.js";
import { isTerminalTaskState } from "./task-helpers.js";
import { transitionItemWithWarning } from "./transition-item-with-warning.js";
import type {
  ManagedDesktopProvisioner,
  WorkboardDispatcherRepository,
  WorkboardLogger,
  WorkboardSubagentRuntime,
} from "./types.js";

const DEFAULT_EXECUTION_WIP_LIMIT = 2;
const EXECUTION_SLOT_TTL_MS = 60_000;
const ORPHAN_RETRY_KEY_PREFIX = "work.dispatch.orphan_retry";

function isInterruptError(error: unknown): boolean {
  return error instanceof Error && error.name === "LaneQueueInterruptError";
}

function orphanRetryKey(taskId: string): string {
  return `${ORPHAN_RETRY_KEY_PREFIX}.${taskId}`;
}

export class WorkboardDispatcher {
  private readonly subagents: SubagentService;
  private readonly activeLaunches = new Set<Promise<void>>();

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
    const [readyRows, doingRows] = await Promise.all([
      this.opts.repository.listReadyItems(25),
      this.opts.repository.listDoingItems(25),
    ]);
    const seen = new Set<string>();

    for (const row of [...readyRows, ...doingRows]) {
      const key = `${row.tenant_id}:${row.agent_id}:${row.workspace_id}:${row.work_item_id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      await this.tryDispatchItem(row, row.work_item_id);
    }
  }

  private async tryDispatchItem(scope: WorkScope, workItemId: string): Promise<number> {
    const item = await this.opts.repository.getItem({ scope, work_item_id: workItemId });
    if (!item || (item.status !== "ready" && item.status !== "doing")) {
      return 0;
    }

    await ensureExecutionTask({
      repository: this.opts.repository,
      scope,
      workItemId,
    });

    const leaseOwner = `${this.opts.owner?.trim() || "workboard-dispatcher"}:${workItemId}`;
    const leased = await this.opts.repository.leaseRunnableTasks({
      scope,
      work_item_id: workItemId,
      lease_owner: leaseOwner,
      limit: 25,
    });
    if (leased.leased.length === 0) {
      return 0;
    }

    const selected: WorkItemTask[] = [];
    for (const entry of leased.leased) {
      if (entry.task.execution_profile === "planner") {
        await requeueLeasedTask({
          repository: this.opts.repository,
          scope,
          taskId: entry.task.task_id,
          leaseOwner,
        });
        continue;
      }

      const acquired = await this.opts.repository.acquireExecutionSlot({
        scope,
        task_id: entry.task.task_id,
        owner: leaseOwner,
        limit: DEFAULT_EXECUTION_WIP_LIMIT,
        ttlMs: EXECUTION_SLOT_TTL_MS,
      });
      if (!acquired) {
        await requeueLeasedTask({
          repository: this.opts.repository,
          scope,
          taskId: entry.task.task_id,
          leaseOwner,
        });
        continue;
      }
      selected.push(entry.task);
    }

    if (selected.length === 0) {
      return 0;
    }

    if (item.status === "ready") {
      try {
        await this.opts.repository.transitionItem({
          scope,
          work_item_id: workItemId,
          status: "doing",
          reason: "Auto-dispatched to executor.",
        });
      } catch (error) {
        for (const task of selected) {
          await this.opts.repository.releaseExecutionSlot({ scope, task_id: task.task_id });
          await requeueLeasedTask({
            repository: this.opts.repository,
            scope,
            taskId: task.task_id,
            leaseOwner,
          });
        }
        this.opts.logger?.warn("workboard.transition_item_failed", {
          context: "dispatch_start",
          tenant_id: scope.tenant_id,
          agent_id: scope.agent_id,
          workspace_id: scope.workspace_id,
          work_item_id: workItemId,
          status: "doing",
          reason: "Auto-dispatched to executor.",
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      }
    }

    await this.opts.repository.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: workItemId },
      key: "work.dispatch.phase",
      value_json: "running",
      provenance_json: { source: "workboard.dispatcher" },
    });

    for (const task of selected) {
      this.launchExecutionTask({
        scope,
        workItemId,
        leaseOwner,
        task,
      });
    }

    return selected.length;
  }

  private launchExecutionTask(params: {
    scope: WorkScope;
    workItemId: string;
    leaseOwner: string;
    task: WorkItemTask;
  }): void {
    const promise = this.runExecutionTask(params).finally(() => {
      this.activeLaunches.delete(promise);
    });
    this.activeLaunches.add(promise);
  }

  private async runExecutionTask(params: {
    scope: WorkScope;
    workItemId: string;
    leaseOwner: string;
    task: WorkItemTask;
  }): Promise<void> {
    const finishedAt = () => new Date().toISOString();
    let subagentId: string | undefined;

    try {
      const item = await this.opts.repository.getItem({
        scope: params.scope,
        work_item_id: params.workItemId,
      });
      if (!item || (item.status !== "ready" && item.status !== "doing")) {
        return;
      }

      const currentTasks = await this.opts.repository.listTasks({
        scope: params.scope,
        work_item_id: params.workItemId,
      });
      const runtimeTask =
        currentTasks.find((task) => task.task_id === params.task.task_id) ?? params.task;
      if (isTerminalTaskState(runtimeTask.status)) {
        return;
      }

      const prepared = await prepareExecutionSubagent({
        repository: this.opts.repository,
        runtime: this.opts.runtime,
        subagents: this.subagents,
        desktopProvisioner: this.opts.desktopProvisioner,
        scope: params.scope,
        item,
        task: runtimeTask,
      });
      subagentId = prepared.subagent.subagent_id;

      await this.opts.repository.updateTask({
        scope: params.scope,
        task_id: runtimeTask.task_id,
        lease_owner: params.leaseOwner,
        patch: {
          status: "running",
          started_at: finishedAt(),
          subagent_id: prepared.subagent.subagent_id,
        },
      });
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
        key: orphanRetryKey(runtimeTask.task_id),
        value_json: 0,
        provenance_json: { source: "workboard.dispatcher" },
      });

      const reply = await this.opts.runtime.runTurn({
        scope: params.scope,
        subagent: prepared.subagent,
        message: buildExecutorInstruction({
          item,
          task: runtimeTask,
          tasks: currentTasks,
          attachedNodeId: prepared.attachedNodeId,
          resumed: prepared.reusedPausedSubagent,
        }),
      });

      await this.opts.repository.updateTask({
        scope: params.scope,
        task_id: runtimeTask.task_id,
        patch: {
          status: "completed",
          finished_at: finishedAt(),
          result_summary: reply || "Executor task completed.",
        },
      });
      await this.opts.repository.markSubagentClosed({
        scope: params.scope,
        subagent_id: prepared.subagent.subagent_id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isInterruptError(error)) {
        const item = await this.opts.repository.getItem({
          scope: params.scope,
          work_item_id: params.workItemId,
        });
        const task = (
          await this.opts.repository.listTasks({
            scope: params.scope,
            work_item_id: params.workItemId,
          })
        ).find((entry) => entry.task_id === params.task.task_id);

        if (
          task?.status === "paused" ||
          task?.status === "cancelled" ||
          item?.status === "cancelled"
        ) {
          return;
        }

        if (task && !isTerminalTaskState(task.status)) {
          await this.opts.repository.updateTask({
            scope: params.scope,
            task_id: task.task_id,
            patch: {
              status: "paused",
              approval_id: null,
              pause_reason: "manual",
              pause_detail: message,
              result_summary: message,
            },
          });
        }
        if (subagentId) {
          await this.opts.repository.updateSubagent({
            scope: params.scope,
            subagent_id: subagentId,
            patch: { status: "paused" },
          });
        }
        await this.opts.repository.setStateKv({
          scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
          key: "work.dispatch.phase",
          value_json: "awaiting_human",
          provenance_json: { source: "workboard.dispatcher" },
        });
        const currentItem = await this.opts.repository.getItem({
          scope: params.scope,
          work_item_id: params.workItemId,
        });
        if (currentItem?.status === "doing") {
          await transitionItemWithWarning({
            repository: this.opts.repository,
            logger: this.opts.logger,
            scope: params.scope,
            workItemId: params.workItemId,
            status: "blocked",
            reason: message,
            context: "dispatch_interrupted",
          });
        }
        return;
      }

      await this.opts.repository.updateTask({
        scope: params.scope,
        task_id: params.task.task_id,
        patch: {
          status: "failed",
          finished_at: finishedAt(),
          result_summary: message,
        },
      });
      if (subagentId) {
        await this.opts.repository.markSubagentFailed({
          scope: params.scope,
          subagent_id: subagentId,
          reason: message,
        });
      }
      await this.opts.repository.setStateKv({
        scope: { kind: "work_item", ...params.scope, work_item_id: params.workItemId },
        key: "work.dispatch.phase",
        value_json: "blocked",
        provenance_json: { source: "workboard.dispatcher" },
      });
      await transitionItemWithWarning({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope: params.scope,
        workItemId: params.workItemId,
        status: "blocked",
        reason: message,
        context: "dispatch_failed",
      });
      this.opts.logger?.warn("workboard.executor_turn_failed", {
        work_item_id: params.workItemId,
        task_id: params.task.task_id,
        subagent_id: subagentId,
        error: message,
      });
    } finally {
      await this.opts.repository.releaseExecutionSlot({
        scope: params.scope,
        task_id: params.task.task_id,
      });
      await reconcileItemDispatchState({
        repository: this.opts.repository,
        logger: this.opts.logger,
        scope: params.scope,
        workItemId: params.workItemId,
      });
    }
  }
}
