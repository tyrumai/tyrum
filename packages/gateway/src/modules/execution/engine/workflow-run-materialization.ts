import type {
  WorkflowRun as WorkflowRunT,
  WorkflowRunStep as WorkflowRunStepT,
} from "@tyrum/contracts";
import { defaultExecutionClock, type EnqueuePlanInput } from "@tyrum/runtime-execution";
import type { Logger } from "../../observability/logger.js";
import type { SqlDb } from "../../../statestore/types.js";
import { WorkflowRunDal } from "../../workflow-run/dal.js";

export interface WorkflowRunMaterializerDeps {
  db: SqlDb;
  logger?: Logger;
  materializeExecutionStateInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowRunTerminal(status: string): boolean {
  return status === "cancelled" || status === "failed" || status === "succeeded";
}

function buildEnqueuePlanInput(input: {
  workflowRun: WorkflowRunT;
  steps: WorkflowRunStepT[];
}): EnqueuePlanInput {
  const conversationKey = input.workflowRun.conversation_key ?? input.workflowRun.run_key;
  return {
    tenantId: input.workflowRun.tenant_id,
    jobId: input.workflowRun.workflow_run_id,
    turnId: input.workflowRun.workflow_run_id,
    key: conversationKey,
    workspaceId: input.workflowRun.workspace_id,
    planId: input.workflowRun.plan_id ?? input.workflowRun.workflow_run_id,
    requestId: input.workflowRun.request_id ?? input.workflowRun.workflow_run_id,
    inputPayload: isRecord(input.workflowRun.input) ? input.workflowRun.input : undefined,
    steps: input.steps.map((step) => step.action),
    policySnapshotId: input.workflowRun.policy_snapshot_id ?? undefined,
    budgets: input.workflowRun.budgets ?? undefined,
    trigger: {
      kind: input.workflowRun.trigger.kind,
      conversation_key: conversationKey,
      metadata: input.workflowRun.trigger.metadata,
    },
  };
}

export class WorkflowRunMaterializer {
  constructor(private readonly deps: WorkflowRunMaterializerDeps) {}

  private async turnExists(turnId: string): Promise<boolean> {
    const row = await this.deps.db.get<{ turn_id: string }>(
      "SELECT turn_id FROM turns WHERE turn_id = ? LIMIT 1",
      [turnId],
    );
    return row?.turn_id === turnId;
  }

  async syncWorkflowRunFromTurn(turnId: string): Promise<void> {
    const row = await this.deps.db.get<{
      tenant_id: string;
      turn_id: string;
      status: string;
      attempt: number;
      started_at: string | Date | null;
      finished_at: string | Date | null;
      blocked_reason: string | null;
      blocked_detail: string | null;
    }>(
      `SELECT
         tenant_id,
         turn_id,
         status,
         attempt,
         started_at,
         finished_at,
         blocked_reason,
         blocked_detail
       FROM turns
       WHERE turn_id = ?`,
      [turnId],
    );
    if (!row) {
      return;
    }

    const { nowIso } = defaultExecutionClock();
    await this.deps.db.run(
      `UPDATE workflow_runs
       SET status = ?,
           attempt = ?,
           updated_at = ?,
           started_at = ?,
           finished_at = ?,
           blocked_reason = ?,
           blocked_detail = ?
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [
        row.status,
        row.attempt,
        nowIso,
        row.started_at,
        row.finished_at,
        row.blocked_reason,
        row.blocked_detail,
        row.tenant_id,
        row.turn_id,
      ],
    );
  }

  async materializeIfNeeded(workflowRunId: string): Promise<void> {
    const normalizedWorkflowRunId = workflowRunId.trim();
    if (!normalizedWorkflowRunId || (await this.turnExists(normalizedWorkflowRunId))) {
      return;
    }

    try {
      await this.deps.db.transaction(async (tx) => {
        const existingTurn = await tx.get<{ turn_id: string }>(
          "SELECT turn_id FROM turns WHERE turn_id = ? LIMIT 1",
          [normalizedWorkflowRunId],
        );
        if (existingTurn?.turn_id) {
          return;
        }

        const tenantRow = await tx.get<{ tenant_id: string }>(
          "SELECT tenant_id FROM workflow_runs WHERE workflow_run_id = ? LIMIT 1",
          [normalizedWorkflowRunId],
        );
        const tenantId = tenantRow?.tenant_id?.trim();
        if (!tenantId) {
          return;
        }

        const workflowRunDal = new WorkflowRunDal(tx);
        const workflowRun = await workflowRunDal.getRun({
          tenantId,
          workflowRunId: normalizedWorkflowRunId,
        });
        if (!workflowRun || isWorkflowRunTerminal(workflowRun.status)) {
          return;
        }

        const steps = await workflowRunDal.listSteps({
          tenantId,
          workflowRunId: normalizedWorkflowRunId,
        });
        await this.deps.materializeExecutionStateInTx(
          tx,
          buildEnqueuePlanInput({ workflowRun, steps }),
        );
      });
    } catch (error) {
      if (await this.turnExists(normalizedWorkflowRunId)) {
        return;
      }
      this.deps.logger?.warn("execution.workflow_run_materialize_failed", {
        workflow_run_id: normalizedWorkflowRunId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async materializeNextQueued(): Promise<void> {
    const row = await this.deps.db.get<{ workflow_run_id: string }>(
      `SELECT workflow_run_id
       FROM workflow_runs
       WHERE status = 'queued'
         AND NOT EXISTS (
           SELECT 1
           FROM turns
           WHERE turns.tenant_id = workflow_runs.tenant_id
             AND turns.turn_id = workflow_runs.workflow_run_id
         )
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    if (!row?.workflow_run_id) {
      return;
    }
    await this.materializeIfNeeded(row.workflow_run_id);
  }

  async cancelIfPresent(
    workflowRunId: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    const normalizedWorkflowRunId = workflowRunId.trim();
    if (!normalizedWorkflowRunId) {
      return "not_found";
    }

    const { nowIso } = defaultExecutionClock();
    return await this.deps.db.transaction(async (tx) => {
      const updatedRun = await tx.get<{ tenant_id: string }>(
        `UPDATE workflow_runs
         SET status = 'cancelled',
             updated_at = ?,
             finished_at = COALESCE(finished_at, ?)
         WHERE workflow_run_id = ?
           AND status NOT IN ('cancelled', 'failed', 'succeeded')
         RETURNING tenant_id`,
        [nowIso, nowIso, normalizedWorkflowRunId],
      );
      if (!updatedRun?.tenant_id) {
        const row = await tx.get<{ status: string }>(
          `SELECT status
           FROM workflow_runs
           WHERE workflow_run_id = ?`,
          [normalizedWorkflowRunId],
        );
        if (!row) {
          return "not_found";
        }
        return isWorkflowRunTerminal(row.status) ? "already_terminal" : "not_found";
      }

      await tx.run(
        `UPDATE workflow_run_steps
         SET status = 'cancelled',
             updated_at = ?,
             finished_at = COALESCE(finished_at, ?)
         WHERE tenant_id = ?
           AND workflow_run_id = ?
           AND status IN ('queued', 'running', 'paused')`,
        [nowIso, nowIso, updatedRun.tenant_id, normalizedWorkflowRunId],
      );
      return "cancelled";
    });
  }
}
