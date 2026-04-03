import type { PlaybookRuntimeEnvelope as PlaybookRuntimeEnvelopeT } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { ApprovalRow } from "../approval/dal.js";
import type { SqlDb } from "../../statestore/types.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_KEY,
  IdentityScopeDal,
  type IdentityScopeDal as IdentityScopeDalT,
  requirePrimaryAgentId,
} from "../identity/scope.js";
import { WorkflowRunDal } from "../workflow-run/dal.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function loadPendingApprovalForTurn(
  db: SqlDb,
  turnId: string,
): Promise<
  | {
      prompt: string;
      resumeToken: string;
    }
  | undefined
> {
  const row = await db.get<{ prompt: string; resume_token: string | null }>(
    `SELECT prompt, resume_token
     FROM approvals
     WHERE tenant_id = ?
       AND turn_id = ?
       AND status IN ('queued', 'reviewing', 'awaiting_human')
     ORDER BY created_at DESC
     LIMIT 1`,
    [DEFAULT_TENANT_ID, turnId],
  );
  const resumeToken = row?.resume_token?.trim();
  if (!row?.prompt || !resumeToken) return undefined;
  return { prompt: row.prompt, resumeToken };
}

async function loadPendingApprovalForWorkflowRun(
  db: SqlDb,
  workflowRunId: string,
): Promise<
  | {
      prompt: string;
      resumeToken: string;
    }
  | undefined
> {
  const row = await db.get<{ prompt: string; resume_token: string | null }>(
    `SELECT approvals.prompt, approvals.resume_token
     FROM approvals
     LEFT JOIN workflow_run_steps
       ON workflow_run_steps.tenant_id = approvals.tenant_id
      AND workflow_run_steps.workflow_run_step_id = approvals.workflow_run_step_id
     WHERE approvals.tenant_id = ?
       AND approvals.status IN ('queued', 'reviewing', 'awaiting_human')
       AND (
         approvals.turn_id = ?
         OR workflow_run_steps.workflow_run_id = ?
       )
     ORDER BY approvals.created_at DESC
     LIMIT 1`,
    [DEFAULT_TENANT_ID, workflowRunId, workflowRunId],
  );
  const resumeToken = row?.resume_token?.trim();
  if (!row?.prompt || !resumeToken) return undefined;
  return { prompt: row.prompt, resumeToken };
}

async function hasPendingApprovalForTurn(db: SqlDb, turnId: string): Promise<boolean> {
  const row = await db.get<{ n: number }>(
    `SELECT 1 AS n
     FROM approvals
     WHERE tenant_id = ?
       AND turn_id = ?
       AND status IN ('queued', 'reviewing', 'awaiting_human')
     LIMIT 1`,
    [DEFAULT_TENANT_ID, turnId],
  );
  return Boolean(row);
}

async function hasPendingApprovalForWorkflowRun(
  db: SqlDb,
  workflowRunId: string,
): Promise<boolean> {
  const row = await db.get<{ n: number }>(
    `SELECT 1 AS n
     FROM approvals
     LEFT JOIN workflow_run_steps
       ON workflow_run_steps.tenant_id = approvals.tenant_id
      AND workflow_run_steps.workflow_run_step_id = approvals.workflow_run_step_id
     WHERE approvals.tenant_id = ?
       AND approvals.status IN ('queued', 'reviewing', 'awaiting_human')
       AND (
         approvals.turn_id = ?
         OR workflow_run_steps.workflow_run_id = ?
       )
     LIMIT 1`,
    [DEFAULT_TENANT_ID, workflowRunId, workflowRunId],
  );
  return Boolean(row);
}

async function loadTurnErrorMessage(db: SqlDb, turnId: string): Promise<string | undefined> {
  const row = await db.get<{ error: string | null }>(
    `SELECT a.error
     FROM execution_attempts a
     JOIN execution_steps s ON s.step_id = a.step_id
     WHERE s.turn_id = ? AND a.error IS NOT NULL
     ORDER BY a.started_at DESC
     LIMIT 1`,
    [turnId],
  );
  const message = row?.error?.trim();
  return message && message.length > 0 ? message : undefined;
}

async function hasWorkflowRun(db: SqlDb, workflowRunId: string): Promise<boolean> {
  const row = await db.get<{ workflow_run_id: string }>(
    "SELECT workflow_run_id FROM workflow_runs WHERE workflow_run_id = ? LIMIT 1",
    [workflowRunId],
  );
  return row?.workflow_run_id === workflowRunId;
}

async function waitForTurnToSettle(
  db: SqlDb,
  turnId: string,
  timeoutMs: number,
): Promise<{ status: string; pausedReason: string | null; pausedDetail: string | null }> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{
      status: string;
      blocked_reason: string | null;
      blocked_detail: string | null;
    }>("SELECT status, blocked_reason, blocked_detail FROM turns WHERE turn_id = ?", [turnId]);
    if (!row) {
      throw new Error(`execution turn '${turnId}' not found`);
    }

    if (
      row.status === "paused" ||
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return {
        status: row.status,
        pausedReason: row.blocked_reason,
        pausedDetail: row.blocked_detail,
      };
    }

    if (Date.now() >= deadline) {
      throw new Error(`execution turn '${turnId}' did not settle within ${String(timeoutMs)}ms`);
    }

    await sleep(25);
  }
}

async function waitForWorkflowRunToSettle(
  db: SqlDb,
  workflowRunId: string,
  timeoutMs: number,
): Promise<{ status: string; pausedReason: string | null; pausedDetail: string | null }> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{
      status: string;
      blocked_reason: string | null;
      blocked_detail: string | null;
    }>(
      "SELECT status, blocked_reason, blocked_detail FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    if (!row) {
      throw new Error(`workflow run '${workflowRunId}' not found`);
    }

    if (
      row.status === "paused" ||
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return {
        status: row.status,
        pausedReason: row.blocked_reason,
        pausedDetail: row.blocked_detail,
      };
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `workflow run '${workflowRunId}' did not settle within ${String(timeoutMs)}ms`,
      );
    }

    await sleep(25);
  }
}

async function waitForTurnToResumeOrCancel(
  db: SqlDb,
  turnId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{ status: string }>("SELECT status FROM turns WHERE turn_id = ?", [
      turnId,
    ]);
    if (!row) {
      throw new Error(`execution turn '${turnId}' not found`);
    }

    if (row.status !== "paused") return;
    if (await hasPendingApprovalForTurn(db, turnId)) return;

    if (Date.now() >= deadline) {
      throw new Error(
        `execution turn '${turnId}' did not resume/cancel within ${String(timeoutMs)}ms`,
      );
    }

    await sleep(25);
  }
}

async function waitForWorkflowRunToResumeOrCancel(
  db: SqlDb,
  workflowRunId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    if (!row) {
      throw new Error(`workflow run '${workflowRunId}' not found`);
    }

    if (row.status !== "paused") return;

    if (await hasPendingApprovalForWorkflowRun(db, workflowRunId)) return;

    if (Date.now() >= deadline) {
      throw new Error(
        `workflow run '${workflowRunId}' did not resume/cancel within ${String(timeoutMs)}ms`,
      );
    }

    await sleep(25);
  }
}

async function envelopeForTurnStatus(
  db: SqlDb,
  turnId: string,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  let row: { status: string; pausedReason: string | null; pausedDetail: string | null };
  try {
    row = await waitForTurnToSettle(db, turnId, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("did not settle")
      ? "timeout"
      : message.includes("not found")
        ? "not_found"
        : "internal";
    return { ok: false, status: "error", output: [], error: { message, code } };
  }

  if (row.status === "succeeded") return { ok: true, status: "ok", output: [] };
  if (row.status === "cancelled") return { ok: true, status: "cancelled", output: [] };
  if (row.status === "paused") {
    const approval = await loadPendingApprovalForTurn(db, turnId);
    if (!approval) {
      return {
        ok: false,
        status: "error",
        output: [],
        error: { message: `turn '${turnId}' is paused but no pending approval was found` },
      };
    }
    return {
      ok: true,
      status: "needs_approval",
      output: [],
      requiresApproval: {
        prompt: approval.prompt,
        items: [],
        resumeToken: approval.resumeToken,
      },
    };
  }

  const errorMessage =
    (await loadTurnErrorMessage(db, turnId)) ||
    row.pausedDetail?.trim() ||
    row.pausedReason?.trim() ||
    `execution turn '${turnId}' failed`;

  return { ok: false, status: "error", output: [], error: { message: errorMessage } };
}

async function envelopeForWorkflowRunStatus(
  db: SqlDb,
  workflowRunId: string,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  let row: { status: string; pausedReason: string | null; pausedDetail: string | null };
  try {
    row = await waitForWorkflowRunToSettle(db, workflowRunId, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("did not settle")
      ? "timeout"
      : message.includes("not found")
        ? "not_found"
        : "internal";
    return { ok: false, status: "error", output: [], error: { message, code } };
  }

  if (row.status === "succeeded") return { ok: true, status: "ok", output: [] };
  if (row.status === "cancelled") return { ok: true, status: "cancelled", output: [] };
  if (row.status === "paused") {
    const approval = await loadPendingApprovalForWorkflowRun(db, workflowRunId);
    if (!approval) {
      return {
        ok: false,
        status: "error",
        output: [],
        error: {
          message: `workflow run '${workflowRunId}' is paused but no pending approval was found`,
        },
      };
    }
    return {
      ok: true,
      status: "needs_approval",
      output: [],
      requiresApproval: {
        prompt: approval.prompt,
        items: [],
        resumeToken: approval.resumeToken,
      },
    };
  }

  const errorMessage =
    (await loadTurnErrorMessage(db, workflowRunId)) ||
    row.pausedDetail?.trim() ||
    row.pausedReason?.trim() ||
    `workflow run '${workflowRunId}' failed`;

  return { ok: false, status: "error", output: [], error: { message: errorMessage } };
}

export async function envelopeForPlaybookRuntimeStatus(
  db: SqlDb,
  executionId: string,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  if (await hasWorkflowRun(db, executionId)) {
    return await envelopeForWorkflowRunStatus(db, executionId, timeoutMs);
  }
  return await envelopeForTurnStatus(db, executionId, timeoutMs);
}

export async function waitForPlaybookRuntimeResume(
  db: SqlDb,
  executionId: string,
  timeoutMs: number,
): Promise<void> {
  if (await hasWorkflowRun(db, executionId)) {
    await waitForWorkflowRunToResumeOrCancel(db, executionId, timeoutMs);
    return;
  }
  await waitForTurnToResumeOrCancel(db, executionId, timeoutMs);
}

export async function resolveApprovalExecutionId(
  db: SqlDb,
  approval: ApprovalRow,
): Promise<string | undefined> {
  const turnId = approval.turn_id?.trim();
  if (turnId) {
    return turnId;
  }

  const workflowRunStepId = approval.workflow_run_step_id?.trim();
  if (!workflowRunStepId) {
    return undefined;
  }

  const workflowRun = await db.get<{ workflow_run_id: string }>(
    `SELECT workflow_run_id
     FROM workflow_run_steps
     WHERE tenant_id = ?
       AND workflow_run_step_id = ?
     LIMIT 1`,
    [approval.tenant_id, workflowRunStepId],
  );
  const workflowRunId = workflowRun?.workflow_run_id?.trim();
  return workflowRunId || undefined;
}

export async function createPlaybookWorkflowRun(input: {
  db: SqlDb;
  identityScopeDal?: IdentityScopeDalT;
  runKey: string;
  planId: string;
  requestId: string;
  triggerMetadata: Record<string, unknown>;
  steps: ReadonlyArray<unknown>;
  policySnapshotId: string;
}): Promise<string> {
  const identityScopeDal = input.identityScopeDal ?? new IdentityScopeDal(input.db);
  const agentId = await requirePrimaryAgentId(identityScopeDal, DEFAULT_TENANT_ID);
  const workspaceId = await identityScopeDal.ensureWorkspaceId(
    DEFAULT_TENANT_ID,
    DEFAULT_WORKSPACE_KEY,
  );
  await identityScopeDal.ensureMembership(DEFAULT_TENANT_ID, agentId, workspaceId);

  const workflowRunId = randomUUID();
  const workflowRunDal = new WorkflowRunDal(input.db);
  await workflowRunDal.createRunWithSteps({
    run: {
      workflowRunId,
      tenantId: DEFAULT_TENANT_ID,
      agentId,
      workspaceId,
      runKey: input.runKey,
      conversationKey: input.runKey,
      trigger: {
        kind: "api",
        metadata: input.triggerMetadata,
      },
      planId: input.planId,
      requestId: input.requestId,
      policySnapshotId: input.policySnapshotId,
    },
    steps: input.steps.map((step) => ({
      action: step,
      policySnapshotId: input.policySnapshotId,
    })),
  });

  return workflowRunId;
}
