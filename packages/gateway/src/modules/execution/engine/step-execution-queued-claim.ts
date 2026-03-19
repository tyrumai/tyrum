import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import { requiredCapability } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import { releaseWorkspaceLeaseTx, tryAcquireWorkspaceLeaseTx } from "../../workspace/lease.js";
import {
  releaseConcurrencySlotsTx,
  releaseLaneLeaseTx,
  touchLaneLeaseTx,
  tryAcquireConcurrencyForAttemptTx,
} from "./concurrency-manager.js";
import type { SqlDb } from "../../../statestore/types.js";
import type { StepClaimOutcome } from "./step-execution.js";
import {
  loadBudgetPolicyRowTx,
  maybeHandleSecretsPolicyTx,
  maybeHandleSnapshotPolicyTx,
  maybePauseForExceededBudgetTx,
  parseStepAction,
  type AttemptClaim,
  type QueuedClaimContext,
} from "./step-execution-queued-policy.js";
import type { StepRow } from "./shared.js";

export async function claimQueuedStepExecutionTx(
  ctx: QueuedClaimContext,
): Promise<StepClaimOutcome> {
  const budgetPolicyRow = await loadBudgetPolicyRowTx(ctx.tx, ctx.run);
  const budgetPause = await maybePauseForExceededBudgetTx(ctx, budgetPolicyRow);
  if (budgetPause) {
    return budgetPause;
  }

  const parsedActionState = parseStepAction(ctx);
  const snapshotOutcome = await maybeHandleSnapshotPolicyTx(
    ctx,
    budgetPolicyRow,
    parsedActionState,
  );
  if (snapshotOutcome) {
    return snapshotOutcome;
  }

  const attempt = await selectAttemptClaimTx(ctx.tx, ctx.next);
  const idempotent = await maybeClaimIdempotentSuccessTx(ctx, attempt);
  if (idempotent) {
    return idempotent;
  }

  const toolIntentPause = await ctx.deps.maybePauseForToolIntentGuardrailTx(ctx.tx, {
    run: ctx.run,
    step: ctx.next,
    actionType: parsedActionState.actionType,
    action: parsedActionState.parsedAction,
    clock: ctx.clock,
    workerId: ctx.workerId,
  });
  if (toolIntentPause) {
    return {
      kind: "paused",
      reason: "approval",
      approvalId: toolIntentPause.approvalId,
    };
  }

  const secretsOutcome = await maybeHandleSecretsPolicyTx(
    ctx,
    parsedActionState,
    attempt,
    ctx.run.policy_snapshot_id ?? null,
  );
  if (secretsOutcome) {
    return secretsOutcome;
  }

  return await claimAttemptTx(ctx, parsedActionState.actionType, attempt);
}

async function selectAttemptClaimTx(tx: SqlDb, next: StepRow): Promise<AttemptClaim> {
  const attemptAgg = await tx.get<{ n: number }>(
    `SELECT COALESCE(MAX(attempt), 0) AS n
     FROM execution_attempts
     WHERE tenant_id = ? AND step_id = ?`,
    [next.tenant_id, next.step_id],
  );
  return {
    attemptId: randomUUID(),
    attemptNum: (attemptAgg?.n ?? 0) + 1,
    leaseTtlMs: Math.max(30_000, next.timeout_ms + 10_000),
  };
}

async function maybeClaimIdempotentSuccessTx(
  { deps, tx, run, next, clock }: QueuedClaimContext,
  attempt: AttemptClaim,
): Promise<StepClaimOutcome | undefined> {
  if (!next.idempotency_key) {
    return undefined;
  }

  const record = await tx.get<{ status: string; result_json: string | null }>(
    `SELECT status, result_json
     FROM idempotency_records
     WHERE tenant_id = ? AND scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
    [next.tenant_id, next.step_id, next.idempotency_key],
  );
  if (record?.status !== "succeeded") {
    return undefined;
  }

  const updated = await tx.run(
    `UPDATE execution_steps
     SET status = 'succeeded'
     WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
    [next.tenant_id, next.step_id],
  );
  if (updated.changes !== 1) {
    return undefined;
  }

  await tx.run(
    `INSERT INTO execution_attempts (
       tenant_id,
       attempt_id,
       step_id,
       attempt,
       status,
       started_at,
       finished_at,
       policy_snapshot_id,
       artifacts_json,
       result_json,
       error
     ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, '[]', ?, NULL)`,
    [
      next.tenant_id,
      attempt.attemptId,
      next.step_id,
      attempt.attemptNum,
      clock.nowIso,
      clock.nowIso,
      run.policy_snapshot_id ?? null,
      record.result_json ?? null,
    ],
  );
  await deps.emitStepUpdatedTx(tx, next.step_id);
  await deps.emitAttemptUpdatedTx(tx, attempt.attemptId);
  return { kind: "idempotent" };
}

async function claimAttemptTx(
  { deps, tx, run, next, workerId, clock }: QueuedClaimContext,
  actionType: ActionPrimitiveT["type"] | undefined,
  attempt: AttemptClaim,
): Promise<StepClaimOutcome> {
  const capability = actionType ? requiredCapability(actionType) : undefined;
  const concurrencyOk = await tryAcquireConcurrencyForAttemptTx(
    tx,
    {
      tenantId: run.tenant_id,
      attemptId: attempt.attemptId,
      owner: workerId,
      nowMs: clock.nowMs,
      nowIso: clock.nowIso,
      ttlMs: attempt.leaseTtlMs,
      agentId: run.agent_id,
      capability,
    },
    deps.concurrencyLimits,
  );
  if (!concurrencyOk) {
    return { kind: "noop" };
  }

  const needsWorkspaceLease = actionType === "CLI";
  if (needsWorkspaceLease) {
    const workspaceOk = await tryAcquireWorkspaceLeaseTx(tx, {
      tenantId: run.tenant_id,
      workspaceId: run.workspace_id,
      owner: workerId,
      nowMs: clock.nowMs,
      ttlMs: attempt.leaseTtlMs,
    });
    if (!workspaceOk) {
      await releaseConcurrencySlotsTx(
        tx,
        run.tenant_id,
        attempt.attemptId,
        clock.nowIso,
        deps.concurrencyLimits,
      );
      await releaseLaneLeaseTx(tx, {
        tenantId: run.tenant_id,
        key: run.key,
        lane: run.lane,
        owner: workerId,
      });
      return { kind: "noop" };
    }
  }

  const updated = await tx.run(
    `UPDATE execution_steps
     SET status = 'running'
     WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
    [next.tenant_id, next.step_id],
  );
  if (updated.changes !== 1) {
    if (needsWorkspaceLease) {
      await releaseWorkspaceLeaseTx(tx, {
        tenantId: run.tenant_id,
        workspaceId: run.workspace_id,
        owner: workerId,
      });
    }
    await releaseConcurrencySlotsTx(
      tx,
      run.tenant_id,
      attempt.attemptId,
      clock.nowIso,
      deps.concurrencyLimits,
    );
    return { kind: "noop" };
  }

  await tx.run(
    `INSERT INTO execution_attempts (
       tenant_id,
       attempt_id,
       step_id,
       attempt,
       status,
       started_at,
       policy_snapshot_id,
       artifacts_json,
       lease_owner,
       lease_expires_at_ms
     ) VALUES (?, ?, ?, ?, 'running', ?, ?, '[]', ?, ?)`,
    [
      next.tenant_id,
      attempt.attemptId,
      next.step_id,
      attempt.attemptNum,
      clock.nowIso,
      run.policy_snapshot_id ?? null,
      workerId,
      clock.nowMs + attempt.leaseTtlMs,
    ],
  );
  await touchLaneLeaseTx(tx, {
    tenantId: run.tenant_id,
    key: run.key,
    lane: run.lane,
    owner: workerId,
    expiresAtMs: clock.nowMs + attempt.leaseTtlMs,
  });

  await deps.emitStepUpdatedTx(tx, next.step_id);
  await deps.emitAttemptUpdatedTx(tx, attempt.attemptId);
  return {
    kind: "claimed",
    tenantId: run.tenant_id,
    agentId: run.agent_id,
    runId: run.run_id,
    jobId: run.job_id,
    workspaceId: run.workspace_id,
    key: run.key,
    lane: run.lane,
    triggerJson: run.trigger_json,
    step: next,
    attempt: {
      attemptId: attempt.attemptId,
      attemptNum: attempt.attemptNum,
    },
  };
}
