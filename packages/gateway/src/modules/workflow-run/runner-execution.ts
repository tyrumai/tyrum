import { randomUUID } from "node:crypto";
import type { ApprovalKind } from "@tyrum/contracts";
import {
  clearTurnLeaseStateTx,
  defaultExecutionClock,
  type StepExecutor,
  type StepResult,
} from "@tyrum/runtime-execution";
import { ApprovalDal } from "../approval/dal.js";
import { executeWithTimeout } from "../execution/engine/concurrency-manager.js";
import { createReviewedApproval } from "../review/review-init.js";
import type { SqlDb } from "../../statestore/types.js";
import {
  approvalPauseReason,
  buildPreparedResult,
  buildStepExecutionContext,
  clearWorkflowRunLeaseTx,
  isRetryableAction,
  isTerminalRunStatus,
  parseAction,
  recordWorkflowRunProgressTx,
  resolveLatestApprovalIdForStep,
  type StepClaim,
  type WorkflowRunRow,
  type WorkflowRunRunnerServices,
  type WorkflowRunStepRow,
} from "./runner-shared.js";

export async function executeWorkflowRunClaim(
  services: WorkflowRunRunnerServices,
  claim: StepClaim,
  executor: StepExecutor,
): Promise<void> {
  const action = parseAction(claim.step);
  const wallStartMs = Date.now();
  const approvalId = await resolveLatestApprovalIdForStep(services.db, {
    tenantId: claim.run.tenant_id,
    workflowRunStepId: claim.step.workflow_run_step_id,
  });
  const context = buildStepExecutionContext({
    run: claim.run,
    step: claim.step,
    attemptId: claim.attemptId,
    approvalId,
  });
  const result = await executeWithTimeout(
    executor,
    action,
    claim.run.plan_id ?? claim.run.workflow_run_id,
    claim.step.step_index,
    Math.max(1, claim.step.timeout_ms),
    context,
  );
  const prepared = buildPreparedResult({
    result,
    postconditionJson: claim.step.postcondition_json,
    wallStartMs,
    redactUnknown: services.redactUnknown,
  });
  const nowIso = defaultExecutionClock().nowIso;

  await services.db.transaction(async (tx) => {
    const currentRun = await tx.get<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE tenant_id = ?
          AND workflow_run_id = ?
        LIMIT 1`,
      [claim.run.tenant_id, claim.run.workflow_run_id],
    );
    if (!currentRun || isTerminalRunStatus(currentRun.status)) {
      return;
    }

    if (prepared.pause) {
      await persistPausedStepTx(services, tx, claim, prepared, nowIso, prepared.pause);
      return;
    }
    if (prepared.pauseDetail) {
      await persistPausedStepTx(services, tx, claim, prepared, nowIso, {
        kind: "takeover",
        prompt: "Takeover required to continue workflow",
        detail: prepared.pauseDetail,
        context: {
          source: "workflow-run",
          workflow_run_id: claim.run.workflow_run_id,
          workflow_run_step_id: claim.step.workflow_run_step_id,
        },
      });
      return;
    }

    if (!result.success || prepared.postconditionError) {
      const error = prepared.postconditionError ?? prepared.error ?? "step failed";
      if (claim.attemptNum < Math.max(1, claim.step.max_attempts) && isRetryableAction(action)) {
        await tx.run(
          `UPDATE workflow_run_steps
              SET status = 'queued',
                  updated_at = ?,
                  error = ?,
                  result_json = ?,
                  metadata_json = ?,
                  artifacts_json = ?,
                  cost_json = ?
            WHERE tenant_id = ?
              AND workflow_run_step_id = ?`,
          [
            nowIso,
            services.redactText(error),
            prepared.resultJson,
            prepared.metadataJson,
            prepared.artifactsJson,
            prepared.costJson,
            claim.run.tenant_id,
            claim.step.workflow_run_step_id,
          ],
        );
        await tx.run(
          `UPDATE workflow_runs
              SET status = 'queued',
                  updated_at = ?
            WHERE tenant_id = ?
              AND workflow_run_id = ?`,
          [nowIso, claim.run.tenant_id, claim.run.workflow_run_id],
        );
        await clearWorkflowRunLeaseTx(tx, {
          tenantId: claim.run.tenant_id,
          workflowRunId: claim.run.workflow_run_id,
        });
        await clearTurnLeaseStateTx(tx, {
          tenantId: claim.run.tenant_id,
          turnId: claim.run.workflow_run_id,
        });
        await recordWorkflowRunProgressTx(tx, {
          tenantId: claim.run.tenant_id,
          workflowRunId: claim.run.workflow_run_id,
          at: nowIso,
          progress: {
            kind: "workflow_run.retry_queued",
            workflow_run_step_id: claim.step.workflow_run_step_id,
            error,
          },
        });
        return;
      }

      await failRunTx(services, tx, claim.run, claim.step, error, nowIso, prepared);
      return;
    }

    const remaining = await tx.get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM workflow_run_steps
        WHERE tenant_id = ?
          AND workflow_run_id = ?
          AND step_index > ?`,
      [claim.run.tenant_id, claim.run.workflow_run_id, claim.step.step_index],
    );
    const isLastStep = (remaining?.n ?? 0) === 0;

    await tx.run(
      `UPDATE workflow_run_steps
          SET status = 'succeeded',
              updated_at = ?,
              finished_at = COALESCE(finished_at, ?),
              result_json = ?,
              metadata_json = ?,
              artifacts_json = ?,
              cost_json = ?,
              error = NULL
        WHERE tenant_id = ?
          AND workflow_run_step_id = ?`,
      [
        nowIso,
        nowIso,
        prepared.resultJson,
        prepared.metadataJson,
        prepared.artifactsJson,
        prepared.costJson,
        claim.run.tenant_id,
        claim.step.workflow_run_step_id,
      ],
    );
    await tx.run(
      `UPDATE workflow_runs
          SET status = ?,
              updated_at = ?,
              finished_at = CASE WHEN ? = 1 THEN COALESCE(finished_at, ?) ELSE finished_at END,
              current_step_index = ?
        WHERE tenant_id = ?
          AND workflow_run_id = ?`,
      [
        isLastStep ? "succeeded" : "queued",
        nowIso,
        isLastStep ? 1 : 0,
        nowIso,
        claim.step.step_index,
        claim.run.tenant_id,
        claim.run.workflow_run_id,
      ],
    );
    await clearWorkflowRunLeaseTx(tx, {
      tenantId: claim.run.tenant_id,
      workflowRunId: claim.run.workflow_run_id,
    });
    await clearTurnLeaseStateTx(tx, {
      tenantId: claim.run.tenant_id,
      turnId: claim.run.workflow_run_id,
    });
    await recordWorkflowRunProgressTx(tx, {
      tenantId: claim.run.tenant_id,
      workflowRunId: claim.run.workflow_run_id,
      at: nowIso,
      progress: {
        kind: isLastStep ? "workflow_run.completed" : "workflow_run.step_completed",
        workflow_run_step_id: claim.step.workflow_run_step_id,
        step_index: claim.step.step_index,
      },
    });
  });
}

async function persistPausedStepTx(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  claim: StepClaim,
  prepared: ReturnType<typeof buildPreparedResult>,
  nowIso: string,
  pause: NonNullable<StepResult["pause"]>,
): Promise<void> {
  await tx.run(
    `UPDATE workflow_run_steps
        SET status = 'paused',
            updated_at = ?,
            result_json = ?,
            metadata_json = ?,
            artifacts_json = ?,
            cost_json = ?,
            error = NULL
      WHERE tenant_id = ?
        AND workflow_run_step_id = ?`,
    [
      nowIso,
      prepared.resultJson,
      prepared.metadataJson,
      prepared.artifactsJson,
      prepared.costJson,
      claim.run.tenant_id,
      claim.step.workflow_run_step_id,
    ],
  );
  await pauseRunForApprovalTx(services, tx, {
    run: claim.run,
    step: claim.step,
    nowIso,
    kind: pause.kind,
    prompt: pause.prompt,
    detail: pause.detail,
    context: pause.context,
    expiresAt: pause.expiresAt ?? undefined,
  });
}

export async function pauseRunForApprovalTx(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  input: {
    run: WorkflowRunRow;
    step: WorkflowRunStepRow;
    nowIso: string;
    kind: ApprovalKind;
    prompt: string;
    detail: string;
    context?: unknown;
    expiresAt?: string;
  },
): Promise<void> {
  const approval = await createReviewedApproval({
    approvalDal: new ApprovalDal(tx),
    policyService: services.policyService,
    params: {
      tenantId: input.run.tenant_id,
      agentId: input.run.agent_id,
      workspaceId: input.run.workspace_id,
      approvalKey: `workflow:${input.run.workflow_run_id}:step:${String(input.step.step_index)}:${input.kind}`,
      prompt: input.prompt,
      motivation: services.redactText(input.detail),
      kind: input.kind,
      context: services.redactUnknown(
        input.context ?? { source: "workflow-run", kind: input.kind },
      ),
      expiresAt: input.expiresAt ?? null,
      planId: input.run.plan_id ?? input.run.workflow_run_id,
      workflowRunStepId: input.step.workflow_run_step_id,
      resumeToken: `resume-${randomUUID()}`,
    },
  });

  await tx.run(
    `UPDATE workflow_runs
        SET status = 'paused',
            blocked_reason = ?,
            blocked_detail = ?,
            updated_at = ?
      WHERE tenant_id = ?
        AND workflow_run_id = ?`,
    [
      approvalPauseReason(input.kind),
      services.redactText(input.detail),
      input.nowIso,
      input.run.tenant_id,
      input.run.workflow_run_id,
    ],
  );
  await clearWorkflowRunLeaseTx(tx, {
    tenantId: input.run.tenant_id,
    workflowRunId: input.run.workflow_run_id,
  });
  await clearTurnLeaseStateTx(tx, {
    tenantId: input.run.tenant_id,
    turnId: input.run.workflow_run_id,
  });
  await recordWorkflowRunProgressTx(tx, {
    tenantId: input.run.tenant_id,
    workflowRunId: input.run.workflow_run_id,
    at: input.nowIso,
    progress: {
      kind: "workflow_run.paused",
      workflow_run_step_id: input.step.workflow_run_step_id,
      approval_id: approval.approval_id,
      paused_reason: approvalPauseReason(input.kind),
    },
  });
}

export async function failRunTx(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  run: WorkflowRunRow,
  step: WorkflowRunStepRow,
  error: string,
  nowIso: string,
  prepared?: ReturnType<typeof buildPreparedResult>,
): Promise<void> {
  await tx.run(
    `UPDATE workflow_run_steps
        SET status = 'failed',
            updated_at = ?,
            finished_at = COALESCE(finished_at, ?),
            error = ?,
            result_json = COALESCE(?, result_json),
            metadata_json = COALESCE(?, metadata_json),
            artifacts_json = COALESCE(?, artifacts_json),
            cost_json = COALESCE(?, cost_json)
      WHERE tenant_id = ?
        AND workflow_run_step_id = ?`,
    [
      nowIso,
      nowIso,
      services.redactText(error),
      prepared?.resultJson ?? null,
      prepared?.metadataJson ?? null,
      prepared?.artifactsJson ?? null,
      prepared?.costJson ?? null,
      run.tenant_id,
      step.workflow_run_step_id,
    ],
  );
  await tx.run(
    `UPDATE workflow_run_steps
        SET status = 'cancelled',
            updated_at = ?,
            finished_at = COALESCE(finished_at, ?)
      WHERE tenant_id = ?
        AND workflow_run_id = ?
        AND workflow_run_step_id != ?
        AND status IN ('queued', 'running', 'paused')`,
    [nowIso, nowIso, run.tenant_id, run.workflow_run_id, step.workflow_run_step_id],
  );
  await tx.run(
    `UPDATE workflow_runs
        SET status = 'failed',
            blocked_reason = NULL,
            blocked_detail = ?,
            updated_at = ?,
            finished_at = COALESCE(finished_at, ?)
      WHERE tenant_id = ?
        AND workflow_run_id = ?`,
    [services.redactText(error), nowIso, nowIso, run.tenant_id, run.workflow_run_id],
  );
  await clearWorkflowRunLeaseTx(tx, {
    tenantId: run.tenant_id,
    workflowRunId: run.workflow_run_id,
  });
  await clearTurnLeaseStateTx(tx, {
    tenantId: run.tenant_id,
    turnId: run.workflow_run_id,
  });
  await recordWorkflowRunProgressTx(tx, {
    tenantId: run.tenant_id,
    workflowRunId: run.workflow_run_id,
    at: nowIso,
    progress: {
      kind: "workflow_run.failed",
      workflow_run_step_id: step.workflow_run_step_id,
      error,
    },
  });
}
