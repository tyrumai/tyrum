import { defaultExecutionClock } from "@tyrum/runtime-execution";
import { safeJsonParse } from "../../utils/json.js";
import {
  clearWorkflowRunLeaseTx,
  isTerminalRunStatus,
  normalizeResumeSource,
  recordWorkflowRunProgressTx,
  resolveWorkflowRunIdForResumeToken,
  type WorkflowRunRow,
  type WorkflowRunRunnerServices,
  type WorkflowRunStepRow,
} from "./runner-shared.js";

export async function resumeWorkflowRun(
  services: WorkflowRunRunnerServices,
  token: string,
): Promise<string | undefined> {
  const resumeToken = token.trim();
  if (!resumeToken) {
    return undefined;
  }

  const approval = await services.db.get<{
    tenant_id: string;
    approval_id: string;
    status: string;
    workflow_run_step_id: string | null;
    resume_token: string | null;
    context_json: string | null;
  }>(
    `SELECT tenant_id, approval_id, status, workflow_run_step_id, resume_token, context_json
       FROM approvals
      WHERE resume_token = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [resumeToken],
  );
  if (!approval?.tenant_id || !approval.workflow_run_step_id) {
    return undefined;
  }

  const workflowRunId = await resolveWorkflowRunIdForResumeToken(services.db, {
    tenantId: approval.tenant_id,
    resumeToken,
  });
  if (!workflowRunId) {
    return undefined;
  }

  const context = safeJsonParse(approval.context_json ?? "null", null as unknown);
  const source = normalizeResumeSource(context);
  const shouldResume =
    approval.status === "approved" ||
    ((approval.status === "denied" || approval.status === "expired") &&
      source === "llm-step-tool-execution");

  if (!shouldResume) {
    if (
      approval.status === "denied" ||
      approval.status === "expired" ||
      approval.status === "cancelled"
    ) {
      const reason =
        approval.status === "expired" ? "approval timed out" : `approval ${approval.status}`;
      await cancelWorkflowRun(services, workflowRunId, reason);
      return workflowRunId;
    }
    return undefined;
  }

  const clock = defaultExecutionClock();
  await services.db.transaction(async (tx) => {
    const step = await tx.get<WorkflowRunStepRow>(
      `SELECT *
         FROM workflow_run_steps
        WHERE tenant_id = ?
          AND workflow_run_step_id = ?
        LIMIT 1`,
      [approval.tenant_id, approval.workflow_run_step_id],
    );
    if (!step) {
      throw new Error(`workflow step '${approval.workflow_run_step_id}' not found`);
    }

    const run = await tx.get<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE tenant_id = ?
          AND workflow_run_id = ?
        LIMIT 1`,
      [approval.tenant_id, workflowRunId],
    );
    if (!run || isTerminalRunStatus(run.status)) {
      return;
    }

    await tx.run(
      `UPDATE workflow_run_steps
          SET status = 'queued',
              updated_at = ?,
              error = NULL
        WHERE tenant_id = ?
          AND workflow_run_step_id = ?`,
      [clock.nowIso, approval.tenant_id, approval.workflow_run_step_id],
    );
    await tx.run(
      `UPDATE workflow_runs
          SET status = 'queued',
              blocked_reason = NULL,
              blocked_detail = NULL,
              budget_overridden_at = CASE
                WHEN ? = 'budget' THEN COALESCE(budget_overridden_at, ?)
                ELSE budget_overridden_at
              END,
              updated_at = ?
        WHERE tenant_id = ?
          AND workflow_run_id = ?`,
      [run.blocked_reason ?? "", clock.nowIso, clock.nowIso, approval.tenant_id, workflowRunId],
    );
    await clearWorkflowRunLeaseTx(tx, {
      tenantId: approval.tenant_id,
      workflowRunId,
    });
    await recordWorkflowRunProgressTx(tx, {
      tenantId: approval.tenant_id,
      workflowRunId,
      at: clock.nowIso,
      progress: {
        kind: "workflow_run.resumed",
        approval_id: approval.approval_id,
      },
    });
  });

  return workflowRunId;
}

export async function cancelWorkflowRun(
  services: WorkflowRunRunnerServices,
  workflowRunId: string,
  reason?: string,
): Promise<"cancelled" | "already_terminal" | "not_found"> {
  const runId = workflowRunId.trim();
  if (!runId) {
    return "not_found";
  }

  const clock = defaultExecutionClock();
  return await services.db.transaction(async (tx) => {
    const run = await tx.get<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE workflow_run_id = ?
        LIMIT 1`,
      [runId],
    );
    if (!run) {
      return "not_found";
    }
    if (isTerminalRunStatus(run.status)) {
      return "already_terminal";
    }

    await tx.run(
      `UPDATE workflow_runs
          SET status = 'cancelled',
              blocked_reason = NULL,
              blocked_detail = ?,
              updated_at = ?,
              finished_at = COALESCE(finished_at, ?)
        WHERE tenant_id = ?
          AND workflow_run_id = ?`,
      [reason ?? null, clock.nowIso, clock.nowIso, run.tenant_id, runId],
    );
    await tx.run(
      `UPDATE workflow_run_steps
          SET status = 'cancelled',
              updated_at = ?,
              finished_at = COALESCE(finished_at, ?)
        WHERE tenant_id = ?
          AND workflow_run_id = ?
          AND status IN ('queued', 'running', 'paused')`,
      [clock.nowIso, clock.nowIso, run.tenant_id, runId],
    );
    await clearWorkflowRunLeaseTx(tx, {
      tenantId: run.tenant_id,
      workflowRunId: runId,
    });
    await recordWorkflowRunProgressTx(tx, {
      tenantId: run.tenant_id,
      workflowRunId: runId,
      at: clock.nowIso,
      progress: {
        kind: "workflow_run.cancelled",
        reason: reason ?? null,
      },
    });
    return "cancelled";
  });
}
