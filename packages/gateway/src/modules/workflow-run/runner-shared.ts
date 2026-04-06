import {
  ActionPrimitive,
  evaluatePostcondition,
  PostconditionError,
  requiresPostcondition,
  type ActionPrimitive as ActionPrimitiveT,
  type ApprovalKind,
} from "@tyrum/contracts";
import type { StepExecutionContext, StepResult } from "@tyrum/runtime-execution";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";

export type WorkflowRunRow = {
  tenant_id: string;
  workflow_run_id: string;
  agent_id: string;
  workspace_id: string;
  run_key: string;
  conversation_key: string | null;
  status: string;
  trigger_json: string;
  plan_id: string | null;
  request_id: string | null;
  budgets_json: string | null;
  policy_snapshot_id: string | null;
  budget_overridden_at: string | Date | null;
  started_at: string | Date | null;
  blocked_reason: string | null;
  blocked_detail: string | null;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  created_at: string | Date;
};

export type WorkflowRunStepRow = {
  tenant_id: string;
  workflow_run_step_id: string;
  workflow_run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  idempotency_key: string | null;
  postcondition_json: string | null;
  result_json: string | null;
  error: string | null;
  artifacts_json: string;
  metadata_json: string | null;
  cost_json: string | null;
  policy_snapshot_id: string | null;
  attempt_count: number;
  max_attempts: number;
  timeout_ms: number;
};

export type StepClaim = {
  run: WorkflowRunRow;
  step: WorkflowRunStepRow;
  attemptId: string;
  attemptNum: number;
};

export interface WorkflowRunRunnerServices {
  db: SqlDb;
  policyService?: PolicyService;
  redactText: (text: string) => string;
  redactUnknown: <T>(value: T) => T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeIso(value: string | Date | null): string | null {
  return normalizeDbDateTime(value);
}

export function isTerminalRunStatus(status: string): boolean {
  return status === "cancelled" || status === "failed" || status === "succeeded";
}

export function isRetryableAction(action: ActionPrimitiveT): boolean {
  return Boolean(action.idempotency_key?.trim()) || !requiresPostcondition(action.type);
}

export function approvalPauseReason(kind: ApprovalKind): string {
  if (kind === "budget") return "budget";
  if (kind === "policy") return "policy";
  return "approval";
}

export function parseAction(step: WorkflowRunStepRow): ActionPrimitiveT {
  return ActionPrimitive.parse(JSON.parse(step.action_json) as unknown);
}

export function normalizeResumeSource(context: unknown): string | undefined {
  const record = isRecord(context) ? context : undefined;
  const source = record?.["source"];
  return typeof source === "string" && source.trim().length > 0 ? source.trim() : undefined;
}

export async function listRunnableWorkflowRuns(
  db: SqlDb,
  workflowRunId?: string,
): Promise<WorkflowRunRow[]> {
  if (workflowRunId?.trim()) {
    const row = await db.get<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE workflow_run_id = ?
          AND status IN ('queued', 'running')`,
      [workflowRunId.trim()],
    );
    return row ? [row] : [];
  }

  return await db.all<WorkflowRunRow>(
    `SELECT *
       FROM workflow_runs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at ASC, workflow_run_id ASC`,
  );
}

export async function resolveLatestApprovalIdForStep(
  db: Pick<SqlDb, "get">,
  input: { tenantId: string; workflowRunStepId: string },
): Promise<string | null> {
  const row = await db.get<{ approval_id: string }>(
    `SELECT approval_id
       FROM approvals
      WHERE tenant_id = ?
        AND workflow_run_step_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.tenantId, input.workflowRunStepId],
  );
  return row?.approval_id ?? null;
}

export async function resolveWorkflowRunIdForResumeToken(
  db: Pick<SqlDb, "get">,
  input: { tenantId: string; resumeToken: string },
): Promise<string | undefined> {
  const row = await db.get<{ workflow_run_id: string }>(
    `SELECT s.workflow_run_id
       FROM approvals a
       JOIN workflow_run_steps s
         ON s.tenant_id = a.tenant_id
        AND s.workflow_run_step_id = a.workflow_run_step_id
      WHERE a.tenant_id = ?
        AND a.resume_token = ?
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [input.tenantId, input.resumeToken],
  );
  const workflowRunId = row?.workflow_run_id?.trim();
  return workflowRunId && workflowRunId.length > 0 ? workflowRunId : undefined;
}

export async function recordWorkflowRunProgressTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    workflowRunId: string;
    at: string | null;
    progress: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.run(
    `UPDATE workflow_runs
        SET last_progress_at = ?,
            last_progress_json = ?
      WHERE tenant_id = ?
        AND workflow_run_id = ?`,
    [
      input.at,
      input.progress === null ? null : JSON.stringify(input.progress),
      input.tenantId,
      input.workflowRunId,
    ],
  );
}

export async function clearWorkflowRunLeaseTx(
  tx: SqlDb,
  input: { tenantId: string; workflowRunId: string },
): Promise<void> {
  await tx.run(
    `UPDATE workflow_runs
        SET lease_owner = NULL,
            lease_expires_at_ms = NULL
      WHERE tenant_id = ?
        AND workflow_run_id = ?`,
    [input.tenantId, input.workflowRunId],
  );
}

export function buildStepExecutionContext(input: {
  run: WorkflowRunRow;
  step: WorkflowRunStepRow;
  attemptId: string;
  approvalId: string | null;
}): StepExecutionContext {
  return {
    tenantId: input.run.tenant_id,
    turnId: input.run.workflow_run_id,
    stepId: input.step.workflow_run_step_id,
    attemptId: input.attemptId,
    approvalId: input.approvalId,
    agentId: input.run.agent_id,
    key: input.run.conversation_key ?? input.run.run_key,
    workspaceId: input.run.workspace_id,
    policySnapshotId: input.run.policy_snapshot_id,
  };
}

export function buildPreparedResult(input: {
  result: StepResult;
  postconditionJson: string | null;
  wallStartMs: number;
  redactUnknown: <T>(value: T) => T;
}): {
  resultJson: string | null;
  metadataJson: string | null;
  artifactsJson: string;
  costJson: string;
  error?: string;
  pause?: StepResult["pause"];
  pauseDetail?: string;
  postconditionError?: string;
} {
  const wallDurationMs = Math.max(0, Date.now() - input.wallStartMs);
  const redactedResult = input.redactUnknown(input.result.result);
  const evidence =
    input.result.evidence === undefined ? null : input.redactUnknown(input.result.evidence);
  const artifacts = input.redactUnknown(input.result.artifacts ?? []);
  const cost = input.redactUnknown(
    input.result.cost
      ? { ...input.result.cost, duration_ms: input.result.cost.duration_ms ?? wallDurationMs }
      : { duration_ms: wallDurationMs },
  );

  let postconditionError: string | undefined;
  let pauseDetail: string | undefined;
  if (input.result.success && input.postconditionJson) {
    try {
      const report = evaluatePostcondition(
        JSON.parse(input.postconditionJson) as unknown,
        input.result.evidence ?? {},
      );
      if (!report.passed) {
        postconditionError = "postcondition failed";
      }
    } catch (error) {
      if (error instanceof PostconditionError && error.kind === "missing_evidence") {
        pauseDetail = `postcondition missing evidence: ${error.message}`;
      } else if (error instanceof PostconditionError) {
        postconditionError = `postcondition error: ${error.message}`;
      } else {
        postconditionError = "postcondition error";
      }
    }
  }

  return {
    resultJson: redactedResult === undefined ? null : JSON.stringify(redactedResult),
    metadataJson: evidence === null ? null : JSON.stringify(evidence),
    artifactsJson: JSON.stringify(artifacts),
    costJson: JSON.stringify(cost),
    error: input.result.error,
    pause: input.result.pause,
    pauseDetail,
    postconditionError,
  };
}
