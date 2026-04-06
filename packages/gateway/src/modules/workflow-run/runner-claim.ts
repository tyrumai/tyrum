import { randomUUID } from "node:crypto";
import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import { recordTurnProgressTx, setTurnLeaseStateTx } from "@tyrum/runtime-execution";
import { resolveBuiltinToolEffect } from "../agent/tools.js";
import { toolCallFromAction } from "../execution/engine/tool-call.js";
import { releaseWorkspaceLeaseTx, tryAcquireWorkspaceLeaseTx } from "../workspace/lease.js";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";
import { failRunTx, pauseRunForApprovalTx } from "./runner-execution.js";
import {
  clearWorkflowRunLeaseTx,
  isRecord,
  isRetryableAction,
  isTerminalRunStatus,
  normalizeIso,
  parseAction,
  recordWorkflowRunProgressTx,
  resolveLatestApprovalIdForStep,
  type StepClaim,
  type WorkflowRunRow,
  type WorkflowRunRunnerServices,
  type WorkflowRunStepRow,
} from "./runner-shared.js";

export async function claimNextWorkflowRunStep(
  services: WorkflowRunRunnerServices,
  run: WorkflowRunRow,
  workerId: string,
  nowMs: number,
  nowIso: string,
): Promise<StepClaim | undefined> {
  const leaseTtlMs = 30_000;
  return await services.db.transaction(async (tx) => {
    const latestRun = await tx.get<WorkflowRunRow>(
      `SELECT *
         FROM workflow_runs
        WHERE tenant_id = ?
          AND workflow_run_id = ?
        LIMIT 1`,
      [run.tenant_id, run.workflow_run_id],
    );
    if (!latestRun || latestRun.status === "paused" || isTerminalRunStatus(latestRun.status)) {
      return undefined;
    }

    const leaseAvailable =
      latestRun.lease_owner === null ||
      latestRun.lease_owner === workerId ||
      (latestRun.lease_expires_at_ms !== null && latestRun.lease_expires_at_ms <= nowMs);
    if (!leaseAvailable) {
      return undefined;
    }

    const step = await tx.get<WorkflowRunStepRow>(
      `SELECT *
         FROM workflow_run_steps
        WHERE tenant_id = ?
          AND workflow_run_id = ?
          AND status IN ('queued', 'running', 'paused')
        ORDER BY step_index ASC
        LIMIT 1`,
      [latestRun.tenant_id, latestRun.workflow_run_id],
    );
    if (!step) {
      await tx.run(
        `UPDATE workflow_runs
            SET status = 'succeeded',
                updated_at = ?,
                finished_at = COALESCE(finished_at, ?),
                current_step_index = (
                  SELECT COALESCE(MAX(step_index), 0)
                    FROM workflow_run_steps
                   WHERE tenant_id = ?
                     AND workflow_run_id = ?
                )
          WHERE tenant_id = ?
            AND workflow_run_id = ?
            AND status IN ('queued', 'running')`,
        [
          nowIso,
          nowIso,
          latestRun.tenant_id,
          latestRun.workflow_run_id,
          latestRun.tenant_id,
          latestRun.workflow_run_id,
        ],
      );
      await clearWorkflowRunLeaseTx(tx, {
        tenantId: latestRun.tenant_id,
        workflowRunId: latestRun.workflow_run_id,
      });
      return undefined;
    }

    if (step.status === "paused") {
      return undefined;
    }

    const action = parseAction(step);
    const recoveredStep =
      step.status === "running"
        ? await recoverRunningStep(services, tx, latestRun, step, action, nowIso)
        : step;
    if (!recoveredStep) {
      return undefined;
    }

    if (await maybePauseForBudget(services, tx, latestRun, recoveredStep, nowIso)) {
      return undefined;
    }
    if (await maybePauseForSnapshotPolicy(services, tx, latestRun, recoveredStep, action, nowIso)) {
      return undefined;
    }

    const workspaceLeaseNeeded = action.type === "CLI";
    if (workspaceLeaseNeeded) {
      const workspaceOk = await tryAcquireWorkspaceLeaseTx(tx, {
        tenantId: latestRun.tenant_id,
        workspaceId: latestRun.workspace_id,
        owner: workerId,
        nowMs,
        ttlMs: leaseTtlMs,
      });
      if (!workspaceOk) {
        return undefined;
      }
    }

    const attemptId = randomUUID();
    const updated = await tx.run(
      `UPDATE workflow_run_steps
          SET status = 'running',
              updated_at = ?,
              started_at = COALESCE(started_at, ?),
              attempt_count = attempt_count + 1,
              error = NULL
        WHERE tenant_id = ?
          AND workflow_run_step_id = ?
          AND status = 'queued'`,
      [nowIso, nowIso, latestRun.tenant_id, recoveredStep.workflow_run_step_id],
    );
    if (updated.changes !== 1) {
      if (workspaceLeaseNeeded) {
        await releaseWorkspaceLeaseTx(tx, {
          tenantId: latestRun.tenant_id,
          workspaceId: latestRun.workspace_id,
          owner: workerId,
        });
      }
      return undefined;
    }

    await tx.run(
      `UPDATE workflow_runs
          SET status = 'running',
              updated_at = ?,
              started_at = COALESCE(started_at, ?),
              current_step_index = ?,
              lease_owner = ?,
              lease_expires_at_ms = ?
        WHERE tenant_id = ?
          AND workflow_run_id = ?`,
      [
        nowIso,
        nowIso,
        recoveredStep.step_index,
        workerId,
        nowMs + leaseTtlMs,
        latestRun.tenant_id,
        latestRun.workflow_run_id,
      ],
    );
    await setTurnLeaseStateTx(tx, {
      tenantId: latestRun.tenant_id,
      turnId: latestRun.workflow_run_id,
      owner: workerId,
      expiresAtMs: nowMs + leaseTtlMs,
    });
    await recordTurnProgressTx(tx, {
      tenantId: latestRun.tenant_id,
      turnId: latestRun.workflow_run_id,
      at: nowIso,
      progress: {
        kind: "workflow_run.claimed",
        step_index: recoveredStep.step_index,
        workflow_run_step_id: recoveredStep.workflow_run_step_id,
        attempt_id: attemptId,
      },
    });
    await recordWorkflowRunProgressTx(tx, {
      tenantId: latestRun.tenant_id,
      workflowRunId: latestRun.workflow_run_id,
      at: nowIso,
      progress: {
        kind: "workflow_run.claimed",
        step_index: recoveredStep.step_index,
        workflow_run_step_id: recoveredStep.workflow_run_step_id,
        attempt_id: attemptId,
      },
    });

    return {
      run: latestRun,
      step: {
        ...recoveredStep,
        status: "running",
        attempt_count: recoveredStep.attempt_count + 1,
      },
      attemptId,
      attemptNum: recoveredStep.attempt_count + 1,
    };
  });
}

async function recoverRunningStep(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  run: WorkflowRunRow,
  step: WorkflowRunStepRow,
  action: ActionPrimitiveT,
  nowIso: string,
): Promise<WorkflowRunStepRow | undefined> {
  if (step.attempt_count >= Math.max(1, step.max_attempts)) {
    await failRunTx(services, tx, run, step, "max attempts exhausted during recovery", nowIso);
    return undefined;
  }

  if (!isRetryableAction(action)) {
    await pauseRunForApprovalTx(services, tx, {
      run,
      step,
      nowIso,
      kind: "retry",
      prompt: "Retry required - step is not idempotent",
      detail:
        "Step was interrupted while running and is state-changing without an idempotency key. Approve to retry.",
      context: {
        action_type: action.type,
        attempt_count: step.attempt_count,
        max_attempts: step.max_attempts,
      },
    });
    return undefined;
  }

  await tx.run(
    `UPDATE workflow_run_steps
        SET status = 'queued',
            updated_at = ?
      WHERE tenant_id = ?
        AND workflow_run_step_id = ?
        AND status = 'running'`,
    [nowIso, run.tenant_id, step.workflow_run_step_id],
  );
  return { ...step, status: "queued" };
}

async function maybePauseForBudget(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  run: WorkflowRunRow,
  step: WorkflowRunStepRow,
  nowIso: string,
): Promise<boolean> {
  const parsedBudgets = run.budgets_json
    ? safeJsonParse(run.budgets_json, undefined as unknown)
    : undefined;
  if (!isRecord(parsedBudgets) || normalizeIso(run.budget_overridden_at)) {
    return false;
  }

  const maxDurationMsRaw = parsedBudgets["max_duration_ms"];
  const maxDurationMs =
    typeof maxDurationMsRaw === "number" &&
    Number.isFinite(maxDurationMsRaw) &&
    maxDurationMsRaw > 0
      ? Math.floor(maxDurationMsRaw)
      : undefined;
  if (maxDurationMs === undefined) {
    return false;
  }

  const startedAt = normalizeIso(run.started_at);
  if (!startedAt) {
    return false;
  }

  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  if (elapsedMs <= maxDurationMs) {
    return false;
  }

  await pauseRunForApprovalTx(services, tx, {
    run,
    step,
    nowIso,
    kind: "budget",
    prompt: "Budget exceeded - continue execution?",
    detail: `elapsed_ms=${String(elapsedMs)} > max_duration_ms=${String(maxDurationMs)}`,
    context: {
      budgets: parsedBudgets,
      spent: { elapsed_ms: elapsedMs },
      next_step_index: step.step_index,
    },
  });
  return true;
}

async function maybePauseForSnapshotPolicy(
  services: WorkflowRunRunnerServices,
  tx: SqlDb,
  run: WorkflowRunRow,
  step: WorkflowRunStepRow,
  action: ActionPrimitiveT,
  nowIso: string,
): Promise<boolean> {
  if (!services.policyService || !run.policy_snapshot_id || action.type === "Decide") {
    return false;
  }

  const tool = toolCallFromAction(action);
  const evaluation = await services.policyService.evaluateToolCallFromSnapshot({
    tenantId: run.tenant_id,
    policySnapshotId: run.policy_snapshot_id,
    agentId: run.agent_id,
    workspaceId: run.workspace_id,
    toolId: tool.toolId,
    toolMatchTarget: tool.matchTarget,
    url: tool.url,
    inputProvenance: { source: "workflow", trusted: true },
    toolEffect: resolveBuiltinToolEffect(tool.toolId),
  });
  if (evaluation.decision === "allow" || services.policyService.isObserveOnly()) {
    return false;
  }

  if (evaluation.decision === "deny") {
    await failRunTx(services, tx, run, step, `policy denied ${tool.toolId}`, nowIso);
    return true;
  }

  const latestApprovalId = await resolveLatestApprovalIdForStep(tx, {
    tenantId: run.tenant_id,
    workflowRunStepId: step.workflow_run_step_id,
  });
  if (latestApprovalId) {
    const latestApproval = await tx.get<{ status: string }>(
      `SELECT status
         FROM approvals
        WHERE tenant_id = ?
          AND approval_id = ?
        LIMIT 1`,
      [run.tenant_id, latestApprovalId],
    );
    if (latestApproval?.status === "approved") {
      return false;
    }
  }

  await pauseRunForApprovalTx(services, tx, {
    run,
    step,
    nowIso,
    kind: "policy",
    prompt: "Policy approval required to continue execution",
    detail: `policy requires approval for '${tool.toolId}' (${tool.matchTarget || "unknown"})`,
    context: {
      source: "workflow-run-policy",
      policy_snapshot_id: run.policy_snapshot_id,
      tool_id: tool.toolId,
      tool_match_target: tool.matchTarget,
      url: tool.url,
    },
  });
  return true;
}
