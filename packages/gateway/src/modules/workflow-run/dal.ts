import { randomUUID } from "node:crypto";
import {
  ActionPrimitive,
  WorkflowRunTrigger,
  type ExecutionBudgets,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowRunStatus,
  type WorkflowRunStepStatus,
  type WorkflowRunTrigger as WorkflowRunTriggerT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { RawWorkflowRunRow, RawWorkflowRunStepRow } from "./dal-helpers.js";
import { toWorkflowRun, toWorkflowRunStep } from "./dal-helpers.js";

export class WorkflowRunDal {
  constructor(private readonly db: SqlDb) {}

  async createRun(params: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    runKey: string;
    conversationKey?: string | null;
    trigger: WorkflowRunTriggerT;
    planId?: string | null;
    requestId?: string | null;
    input?: unknown;
    budgets?: ExecutionBudgets;
    policySnapshotId?: string | null;
    workflowRunId?: string;
    status?: WorkflowRunStatus;
    attempt?: number;
    currentStepIndex?: number | null;
    createdAtIso?: string;
    updatedAtIso?: string;
    startedAtIso?: string | null;
    finishedAtIso?: string | null;
    blockedReason?: WorkflowRun["blocked_reason"];
    blockedDetail?: string | null;
    budgetOverriddenAtIso?: string | null;
    leaseOwner?: string | null;
    leaseExpiresAtMs?: number | null;
    checkpoint?: unknown;
    lastProgressAtIso?: string | null;
    lastProgress?: unknown;
  }): Promise<WorkflowRun> {
    const workflowRunId = params.workflowRunId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();
    const updatedAtIso = params.updatedAtIso ?? createdAtIso;
    const trigger = WorkflowRunTrigger.parse(params.trigger);
    const status: WorkflowRunStatus = params.status ?? "queued";

    const row = await this.db.get<RawWorkflowRunRow>(
      `INSERT INTO workflow_runs (
         workflow_run_id,
         tenant_id,
         agent_id,
         workspace_id,
         run_key,
         conversation_key,
         status,
         trigger_json,
         plan_id,
         request_id,
         input_json,
         budgets_json,
         policy_snapshot_id,
         attempt,
         current_step_index,
         created_at,
         updated_at,
         started_at,
         finished_at,
         blocked_reason,
         blocked_detail,
         budget_overridden_at,
         lease_owner,
         lease_expires_at_ms,
         checkpoint_json,
         last_progress_at,
         last_progress_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        workflowRunId,
        params.tenantId,
        params.agentId,
        params.workspaceId,
        params.runKey,
        params.conversationKey ?? null,
        status,
        JSON.stringify(trigger),
        params.planId ?? null,
        params.requestId ?? null,
        params.input === undefined ? null : JSON.stringify(params.input),
        params.budgets === undefined ? null : JSON.stringify(params.budgets),
        params.policySnapshotId ?? null,
        params.attempt ?? 1,
        params.currentStepIndex ?? null,
        createdAtIso,
        updatedAtIso,
        params.startedAtIso ?? null,
        params.finishedAtIso ?? null,
        params.blockedReason ?? null,
        params.blockedDetail ?? null,
        params.budgetOverriddenAtIso ?? null,
        params.leaseOwner ?? null,
        params.leaseExpiresAtMs ?? null,
        params.checkpoint === undefined ? null : JSON.stringify(params.checkpoint),
        params.lastProgressAtIso ?? null,
        params.lastProgress === undefined ? null : JSON.stringify(params.lastProgress),
      ],
    );
    if (!row) {
      throw new Error("workflow run insert failed");
    }
    return toWorkflowRun(row);
  }

  async getRun(params: {
    tenantId: string;
    workflowRunId: string;
  }): Promise<WorkflowRun | undefined> {
    const row = await this.db.get<RawWorkflowRunRow>(
      `SELECT *
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [params.tenantId, params.workflowRunId],
    );
    return row ? toWorkflowRun(row) : undefined;
  }

  async createSteps(params: {
    tenantId: string;
    workflowRunId: string;
    createdAtIso?: string;
    steps: Array<{
      action: unknown;
      status?: WorkflowRunStepStatus;
      idempotencyKey?: string | null;
      postcondition?: unknown;
      metadata?: unknown;
      policySnapshotId?: string | null;
      maxAttempts?: number;
      timeoutMs?: number;
    }>;
  }): Promise<WorkflowRunStep[]> {
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      for (let index = 0; index < params.steps.length; index += 1) {
        const step = params.steps[index]!;
        const action = ActionPrimitive.parse(step.action);
        await tx.run(
          `INSERT INTO workflow_run_steps (
             tenant_id,
             workflow_run_step_id,
             workflow_run_id,
             step_index,
             status,
             action_json,
             created_at,
             updated_at,
             started_at,
             finished_at,
             idempotency_key,
             postcondition_json,
             result_json,
             error,
             artifacts_json,
             metadata_json,
             cost_json,
             policy_snapshot_id,
             policy_decision_json,
             policy_applied_override_ids_json,
             attempt_count,
             max_attempts,
             timeout_ms
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            params.tenantId,
            randomUUID(),
            params.workflowRunId,
            index,
            step.status ?? "queued",
            JSON.stringify(action),
            createdAtIso,
            createdAtIso,
            null,
            null,
            step.idempotencyKey ?? action.idempotency_key ?? null,
            step.postcondition === undefined
              ? action.postcondition
                ? JSON.stringify(action.postcondition)
                : null
              : JSON.stringify(step.postcondition),
            null,
            null,
            "[]",
            step.metadata === undefined ? null : JSON.stringify(step.metadata),
            null,
            step.policySnapshotId ?? null,
            null,
            null,
            0,
            step.maxAttempts ?? 1,
            step.timeoutMs ?? 60_000,
          ],
        );
      }

      const rows = await tx.all<RawWorkflowRunStepRow>(
        `SELECT *
         FROM workflow_run_steps
         WHERE tenant_id = ? AND workflow_run_id = ?
         ORDER BY step_index ASC`,
        [params.tenantId, params.workflowRunId],
      );
      return rows.map(toWorkflowRunStep);
    });
  }

  async listSteps(params: { tenantId: string; workflowRunId: string }): Promise<WorkflowRunStep[]> {
    const rows = await this.db.all<RawWorkflowRunStepRow>(
      `SELECT *
       FROM workflow_run_steps
       WHERE tenant_id = ? AND workflow_run_id = ?
       ORDER BY step_index ASC`,
      [params.tenantId, params.workflowRunId],
    );
    return rows.map(toWorkflowRunStep);
  }
}
