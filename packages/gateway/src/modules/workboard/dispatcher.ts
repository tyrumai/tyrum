import { randomUUID } from "node:crypto";
import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "./dal.js";
import { SubagentService } from "./subagent-service.js";
import {
  buildExecutorInstruction,
  maybeFinalizeWorkItem,
  provisionManagedDesktop,
  resolveAgentKeyById,
  runManagedSubagentTurn,
} from "./orchestration-support.js";
import { isTerminalTaskState } from "./task-helpers.js";

const DEFAULT_TICK_MS = 1_000;

export class WorkboardDispatcher {
  private readonly workboard: WorkboardDal;
  private readonly subagents: SubagentService;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      agents: AgentRegistry;
      sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
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
        this.opts.logger?.error("workboard.dispatcher_tick_failed", { error: message });
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
       WHERE status = 'ready'
       ORDER BY priority DESC, created_at ASC
       LIMIT 10`,
    );
    for (const row of rows) {
      const dispatched = await this.tryDispatchItem(
        {
          tenant_id: row.tenant_id,
          agent_id: row.agent_id,
          workspace_id: row.workspace_id,
        },
        row.work_item_id,
      );
      if (dispatched) {
        return;
      }
    }
  }

  private async tryDispatchItem(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ): Promise<boolean> {
    const item = await this.workboard.getItem({ scope, work_item_id: workItemId });
    if (!item || item.status !== "ready") {
      return false;
    }

    await this.ensureExecutionTask(scope, workItemId);

    const leaseOwner = `${this.opts.owner?.trim() || "workboard-dispatcher"}:${workItemId}`;
    const leased = await this.workboard.leaseRunnableTasks({
      scope,
      work_item_id: workItemId,
      lease_owner: leaseOwner,
      limit: 4,
    });
    const executionTask = leased.leased.find((entry) => entry.task.execution_profile !== "planner");
    for (const entry of leased.leased) {
      if (executionTask && entry.task.task_id === executionTask.task.task_id) continue;
      await this.workboard.updateTask({
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
      await this.workboard.transitionItem({
        scope,
        work_item_id: workItemId,
        status: "doing",
        reason: "Auto-dispatched to executor.",
      });
    } catch {
      // Intentional: dispatch races can invalidate the ready->doing transition; requeue the task.
      await this.workboard.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        lease_owner: leaseOwner,
        patch: { status: "queued" },
      });
      return false;
    }

    const subagentId = randomUUID();
    const agentKey = await resolveAgentKeyById({
      db: this.opts.db,
      tenantId: scope.tenant_id,
      agentId: scope.agent_id,
    });
    const sessionKey = `agent:${agentKey}:subagent:${subagentId}`;

    const needsDesktop =
      (
        await this.workboard.getStateKv({
          scope: { kind: "work_item", ...scope, work_item_id: workItemId },
          key: "work.execution.needs_desktop",
        })
      )?.value_json === true;

    const attachment = needsDesktop
      ? await provisionManagedDesktop({
          db: this.opts.db,
          tenantId: scope.tenant_id,
          sessionLaneNodeAttachmentDal: this.opts.sessionLaneNodeAttachmentDal,
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

    await this.workboard.updateTask({
      scope,
      task_id: executionTask.task.task_id,
      lease_owner: leaseOwner,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
      },
    });

    try {
      const reply = await runManagedSubagentTurn({
        agents: this.opts.agents,
        db: this.opts.db,
        scope,
        subagent,
        message: buildExecutorInstruction({
          item,
          task: executionTask.task,
          attachedNodeId: attachment?.attachedNodeId,
        }),
      });
      await this.workboard.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        patch: {
          status: "completed",
          finished_at: new Date().toISOString(),
          result_summary: reply || "Executor task completed.",
        },
      });
      await this.workboard.markSubagentClosed({
        scope,
        subagent_id: subagent.subagent_id,
      });
      await maybeFinalizeWorkItem({
        workboard: this.workboard,
        scope,
        workItemId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.workboard.updateTask({
        scope,
        task_id: executionTask.task.task_id,
        patch: {
          status: "failed",
          finished_at: new Date().toISOString(),
          result_summary: message,
        },
      });
      await this.workboard.markSubagentFailed({
        scope,
        subagent_id: subagent.subagent_id,
        reason: message,
      });
      await this.workboard
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

  private async ensureExecutionTask(
    scope: { tenant_id: string; agent_id: string; workspace_id: string },
    workItemId: string,
  ): Promise<void> {
    const tasks = await this.workboard.listTasks({ scope, work_item_id: workItemId });
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

    await this.workboard.createTask({
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
