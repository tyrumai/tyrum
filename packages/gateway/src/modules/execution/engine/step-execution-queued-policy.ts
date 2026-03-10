import type {
  ActionPrimitive as ActionPrimitiveT,
  Decision as DecisionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../../policy/domain.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import { buildExecutionPolicyApprovalContext } from "../policy-approval-context.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import { releaseLaneAndWorkspaceLeasesTx } from "./concurrency-manager.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
import type { StepClaimOutcome, StepExecutionClaimDeps } from "./step-execution.js";
import { toolCallFromAction } from "./tool-call.js";
import { normalizeNonnegativeInt, type RunnableRunRow, type StepRow } from "./shared.js";
import type { ExecutionClock } from "./types.js";
import type { SqlDb } from "../../../statestore/types.js";

export interface QueuedClaimContext {
  deps: StepExecutionClaimDeps;
  tx: SqlDb;
  run: RunnableRunRow;
  next: StepRow;
  workerId: string;
  clock: ExecutionClock;
}

export interface BudgetPolicyRow {
  budgets_json: string | null;
  budget_overridden_at: string | Date | null;
  started_at: string | Date | null;
  policy_snapshot_id: string | null;
}

export interface ParsedActionState {
  actionType: ActionPrimitiveT["type"] | undefined;
  parsedAction: ActionPrimitiveT | undefined;
}

export interface AttemptClaim {
  attemptId: string;
  attemptNum: number;
  leaseTtlMs: number;
}

export async function loadBudgetPolicyRowTx(
  tx: SqlDb,
  run: RunnableRunRow,
): Promise<BudgetPolicyRow | undefined> {
  return await tx.get<BudgetPolicyRow>(
    `SELECT budgets_json, budget_overridden_at, started_at, policy_snapshot_id
     FROM execution_runs
     WHERE tenant_id = ? AND run_id = ?`,
    [run.tenant_id, run.run_id],
  );
}

export async function maybePauseForExceededBudgetTx(
  { deps, tx, run, next, workerId, clock }: QueuedClaimContext,
  budgetRow: BudgetPolicyRow | undefined,
): Promise<StepClaimOutcome | undefined> {
  const budgetsRaw = safeJsonParse(budgetRow?.budgets_json ?? null, undefined as unknown);
  const budgets =
    budgetsRaw && typeof budgetsRaw === "object"
      ? (budgetsRaw as Record<string, unknown>)
      : undefined;
  if (!budgets || budgetRow?.budget_overridden_at) return undefined;

  const maxUsdMicros = normalizeNonnegativeInt(budgets["max_usd_micros"]);
  const maxDurationMs = normalizePositiveInt(budgets["max_duration_ms"]);
  const maxTotalTokens = normalizeNonnegativeInt(budgets["max_total_tokens"]);
  const startedAtIso = normalizeDbDateTime(budgetRow?.started_at ?? null);
  const startedAtMs = startedAtIso ? Date.parse(startedAtIso) : Number.NaN;
  const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, clock.nowMs - startedAtMs) : 0;

  const costRows = await tx.all<{ cost_json: string | null }>(
    `SELECT a.cost_json
     FROM execution_attempts a
     JOIN execution_steps s ON s.tenant_id = a.tenant_id AND s.step_id = a.step_id
     WHERE s.tenant_id = ? AND s.run_id = ? AND a.cost_json IS NOT NULL`,
    [run.tenant_id, run.run_id],
  );

  let spentUsdMicros = 0;
  let spentTotalTokens = 0;
  for (const row of costRows) {
    const cost = safeJsonParse(row.cost_json, undefined as unknown);
    if (!cost || typeof cost !== "object") {
      continue;
    }
    const normalizedCost = cost as Record<string, unknown>;
    spentUsdMicros += normalizeNonnegativeInt(normalizedCost["usd_micros"]) ?? 0;
    spentTotalTokens +=
      normalizeNonnegativeInt(normalizedCost["total_tokens"]) ??
      (normalizeNonnegativeInt(normalizedCost["input_tokens"]) ?? 0) +
        (normalizeNonnegativeInt(normalizedCost["output_tokens"]) ?? 0);
  }

  const reasons: string[] = [];
  if (maxUsdMicros !== undefined && spentUsdMicros > maxUsdMicros) {
    reasons.push(
      `spent_usd_micros=${String(spentUsdMicros)} > max_usd_micros=${String(maxUsdMicros)}`,
    );
  }
  if (maxTotalTokens !== undefined && spentTotalTokens > maxTotalTokens) {
    reasons.push(
      `spent_total_tokens=${String(spentTotalTokens)} > max_total_tokens=${String(maxTotalTokens)}`,
    );
  }
  if (maxDurationMs !== undefined && elapsedMs > maxDurationMs) {
    reasons.push(`elapsed_ms=${String(elapsedMs)} > max_duration_ms=${String(maxDurationMs)}`);
  }
  if (reasons.length === 0) return undefined;

  const paused = await deps.approvalManager.pauseRunForApproval(
    tx,
    approvalRunContext(run, next, workerId),
    {
      kind: "budget",
      prompt: "Budget exceeded — continue execution?",
      detail: `Budget exceeded: ${reasons.join("; ")}`,
      context: {
        budgets,
        spent: {
          usd_micros: spentUsdMicros,
          total_tokens: spentTotalTokens,
          elapsed_ms: elapsedMs,
        },
        next_step_index: next.step_index,
      },
    },
  );
  return { kind: "paused", reason: "budget", approvalId: paused.approvalId };
}

export function parseStepAction({ deps, run, next }: QueuedClaimContext): ParsedActionState {
  let actionType: ActionPrimitiveT["type"] | undefined;
  let parsedAction: ActionPrimitiveT | undefined;
  try {
    const parsed = JSON.parse(next.action_json) as ActionPrimitiveT;
    parsedAction = parsed;
    if (typeof parsed?.type === "string") {
      actionType = parsed.type as ActionPrimitiveT["type"];
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("execution.step_action_parse_failed", {
      run_id: run.run_id,
      step_id: next.step_id,
      error: message,
    });
  }
  return { actionType, parsedAction };
}

export async function maybeHandleSnapshotPolicyTx(
  ctx: QueuedClaimContext,
  budgetRow: BudgetPolicyRow | undefined,
  { parsedAction }: ParsedActionState,
): Promise<StepClaimOutcome | undefined> {
  const policySnapshotId = budgetRow?.policy_snapshot_id ?? null;
  if (!policySnapshotId || !parsedAction) {
    return undefined;
  }

  const tool = toolCallFromAction(parsedAction);
  const decision = await evaluateSnapshotToolDecisionTx(ctx, policySnapshotId, tool);
  if (decision === "deny") {
    return await denyStepForPolicySnapshotTx(ctx, policySnapshotId, tool, decision);
  }
  if (decision !== "require_approval") {
    return undefined;
  }

  const alreadyApproved = await ctx.deps.isApprovedPolicyGateTx(
    ctx.tx,
    ctx.run.tenant_id,
    ctx.next.approval_id,
  );
  if (alreadyApproved) return undefined;

  const paused = await ctx.deps.approvalManager.pauseRunForApproval(
    ctx.tx,
    approvalRunContext(ctx.run, ctx.next, ctx.workerId),
    {
      kind: "policy",
      prompt: "Policy approval required to continue execution",
      detail: `policy requires approval for '${tool.toolId}' (${tool.matchTarget || "unknown"})`,
      context: buildExecutionPolicyApprovalContext({
        policySnapshotId,
        toolId: tool.toolId,
        toolMatchTarget: tool.matchTarget,
        url: tool.url,
        decision,
        agentId: ctx.run.agent_id,
        workspaceId: ctx.run.workspace_id,
      }),
    },
  );
  return { kind: "paused", reason: "policy", approvalId: paused.approvalId };
}

async function evaluateSnapshotToolDecisionTx(
  { deps, tx, run, next }: QueuedClaimContext,
  policySnapshotId: string,
  tool: ReturnType<typeof toolCallFromAction>,
): Promise<DecisionT> {
  const policyRow = await tx.get<{ bundle_json: string }>(
    "SELECT bundle_json FROM policy_snapshots WHERE tenant_id = ? AND policy_snapshot_id = ?",
    [run.tenant_id, policySnapshotId],
  );

  let snapshotState: "valid" | "missing" | "invalid" = "missing";
  let policyBundle: PolicyBundleT | undefined;
  if (policyRow?.bundle_json) {
    try {
      policyBundle = PolicyBundle.parse(JSON.parse(policyRow.bundle_json) as unknown);
      snapshotState = "valid";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      snapshotState = "invalid";
      deps.logger?.warn("execution.policy_snapshot_invalid", {
        run_id: run.run_id,
        step_id: next.step_id,
        policy_snapshot_id: policySnapshotId,
        error: message,
      });
    }
  }

  if (snapshotState === "invalid") {
    return deps.policyService?.isEnabled() && deps.policyService.isObserveOnly()
      ? "allow"
      : "require_approval";
  }
  if (deps.policyService?.isEnabled()) {
    const evaluation = await deps.policyService.evaluateToolCallFromSnapshot({
      tenantId: run.tenant_id,
      policySnapshotId,
      agentId: run.agent_id,
      workspaceId: run.workspace_id,
      toolId: tool.toolId,
      toolMatchTarget: tool.matchTarget,
      url: tool.url,
      inputProvenance: { source: "workflow", trusted: true },
    });
    return deps.policyService.isObserveOnly() ? "allow" : evaluation.decision;
  }
  if (snapshotState === "missing" || !policyBundle) {
    return "require_approval";
  }

  const toolsDomain = normalizeDomain(policyBundle.tools, "require_approval");
  const egressDomain = normalizeDomain(policyBundle.network_egress, "require_approval");
  const toolDecision = evaluateDomain(toolsDomain, tool.toolId);
  const egressDecision = tool.url
    ? (() => {
        const normalizedUrl = normalizeUrlForPolicy(tool.url);
        return normalizedUrl.length === 0 ? "allow" : evaluateDomain(egressDomain, normalizedUrl);
      })()
    : "allow";
  return mostRestrictiveDecision(toolDecision, egressDecision);
}

async function denyStepForPolicySnapshotTx(
  { deps, tx, run, next, workerId, clock }: QueuedClaimContext,
  policySnapshotId: string,
  tool: ReturnType<typeof toolCallFromAction>,
  decision: DecisionT,
): Promise<StepClaimOutcome> {
  const updated = await tx.run(
    `UPDATE execution_steps
     SET status = 'failed'
     WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
    [next.tenant_id, next.step_id],
  );
  if (updated.changes !== 1) return { kind: "noop" };

  const attemptAgg = await tx.get<{ n: number }>(
    `SELECT COALESCE(MAX(attempt), 0) AS n
     FROM execution_attempts
     WHERE tenant_id = ? AND step_id = ?`,
    [next.tenant_id, next.step_id],
  );
  const attemptId = randomUUID();
  const attemptNum = (attemptAgg?.n ?? 0) + 1;

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
       result_json,
       error,
       artifacts_json,
       metadata_json
     ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, NULL, ?, '[]', ?)`,
    [
      next.tenant_id,
      attemptId,
      next.step_id,
      attemptNum,
      clock.nowIso,
      clock.nowIso,
      policySnapshotId,
      deps.redactText(`policy denied ${tool.toolId}`).trim() || "policy denied",
      JSON.stringify(
        deps.redactUnknown({
          policy_snapshot_id: policySnapshotId,
          tool_id: tool.toolId,
          tool_match_target: tool.matchTarget,
          url: tool.url,
          decision,
        }),
      ),
    ],
  );

  await tx.run(
    `UPDATE execution_steps
     SET status = 'cancelled'
     WHERE tenant_id = ? AND run_id = ? AND status = 'queued'`,
    [run.tenant_id, run.run_id],
  );
  const runUpdated = await tx.run(
    `UPDATE execution_runs
     SET status = 'failed', finished_at = ?
     WHERE tenant_id = ? AND run_id = ? AND status != 'cancelled'`,
    [clock.nowIso, run.tenant_id, run.run_id],
  );
  await tx.run(
    `UPDATE execution_jobs
     SET status = 'failed'
     WHERE tenant_id = ? AND job_id = ? AND status != 'cancelled'`,
    [run.tenant_id, run.job_id],
  );
  await releaseLaneAndWorkspaceLeasesTx(tx, {
    tenantId: run.tenant_id,
    key: run.key,
    lane: run.lane,
    workspaceId: run.workspace_id,
    owner: workerId,
  });

  await deps.emitStepUpdatedTx(tx, next.step_id);
  await deps.emitAttemptUpdatedTx(tx, attemptId);
  if (runUpdated.changes === 1) {
    await deps.emitRunUpdatedTx(tx, run.run_id);
    await deps.emitRunFailedTx(tx, run.run_id);
  }
  return { kind: "recovered" };
}

export async function maybeHandleSecretsPolicyTx(
  ctx: QueuedClaimContext,
  { actionType, parsedAction }: ParsedActionState,
  attempt: AttemptClaim,
  policySnapshotId: string | null,
): Promise<StepClaimOutcome | undefined> {
  const policy = ctx.deps.policyService;
  if (
    !policy ||
    !policy.isEnabled() ||
    policy.isObserveOnly() ||
    !parsedAction ||
    (actionType !== "CLI" && actionType !== "Http")
  ) {
    return undefined;
  }

  const secretScopes = await ctx.deps.resolveSecretScopesFromArgs(
    ctx.next.tenant_id,
    parsedAction.args ?? {},
    { runId: ctx.run.run_id, stepId: ctx.next.step_id },
  );
  if (secretScopes.length === 0) return undefined;

  const secretsDecision = (
    await policy.evaluateSecretsFromSnapshot({
      tenantId: ctx.next.tenant_id,
      policySnapshotId: ctx.run.policy_snapshot_id,
      secretScopes,
    })
  ).decision;
  if (secretsDecision === "deny") {
    return await denySecretResolutionTx(ctx, secretScopes, attempt, policySnapshotId);
  }
  if (secretsDecision !== "require_approval") return undefined;

  const alreadyApproved = await ctx.deps.isApprovedPolicyGateTx(
    ctx.tx,
    ctx.run.tenant_id,
    ctx.next.approval_id,
  );
  if (alreadyApproved) return undefined;

  const paused = await ctx.deps.approvalManager.pauseRunForApproval(
    ctx.tx,
    approvalRunContext(ctx.run, ctx.next, ctx.workerId),
    {
      kind: "policy",
      prompt: "Policy approval required — secret resolution",
      detail: `Step requires resolving ${String(secretScopes.length)} secret scope(s): ${secretScopes.join(", ")}`,
      context: {
        action_type: actionType,
        secret_scopes: secretScopes,
        policy_snapshot_id: policySnapshotId,
      },
    },
  );
  return { kind: "paused", reason: "policy", approvalId: paused.approvalId };
}

async function denySecretResolutionTx(
  { deps, tx, run, next, workerId, clock }: QueuedClaimContext,
  secretScopes: string[],
  attempt: AttemptClaim,
  policySnapshotId: string | null,
): Promise<StepClaimOutcome> {
  const stepFailed = await tx.run(
    `UPDATE execution_steps
     SET status = 'failed'
     WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
    [next.tenant_id, next.step_id],
  );
  if (stepFailed.changes !== 1) return { kind: "noop" };

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
     ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, '[]', NULL, ?)`,
    [
      next.tenant_id,
      attempt.attemptId,
      next.step_id,
      attempt.attemptNum,
      clock.nowIso,
      clock.nowIso,
      policySnapshotId,
      deps.redactText(`policy denied secret resolution for scopes: ${secretScopes.join(", ")}`),
    ],
  );

  await tx.run(
    `UPDATE execution_steps
     SET status = 'cancelled'
     WHERE tenant_id = ? AND run_id = ?
       AND step_id != ?
       AND status IN ('queued', 'paused', 'running')`,
    [run.tenant_id, run.run_id, next.step_id],
  );
  const runUpdated = await tx.run(
    `UPDATE execution_runs
     SET status = 'failed', finished_at = ?
     WHERE tenant_id = ? AND run_id = ? AND status IN ('running', 'queued')`,
    [clock.nowIso, run.tenant_id, run.run_id],
  );
  await tx.run(
    `UPDATE execution_jobs
     SET status = 'failed'
     WHERE tenant_id = ? AND job_id = ? AND status IN ('queued', 'running')`,
    [run.tenant_id, run.job_id],
  );
  await releaseLaneAndWorkspaceLeasesTx(tx, {
    tenantId: run.tenant_id,
    key: run.key,
    lane: run.lane,
    workspaceId: run.workspace_id,
    owner: workerId,
  });

  await deps.emitAttemptUpdatedTx(tx, attempt.attemptId);
  await deps.emitRunUpdatedTx(tx, run.run_id);
  if (runUpdated.changes === 1) {
    await deps.emitRunFailedTx(tx, run.run_id);
  }

  const stepIds = await tx.all<{ step_id: string }>(
    "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
    [run.tenant_id, run.run_id],
  );
  for (const row of stepIds) {
    await deps.emitStepUpdatedTx(tx, row.step_id);
  }
  return { kind: "finalized" };
}

function approvalRunContext(run: RunnableRunRow, next: StepRow, workerId: string) {
  return {
    tenantId: run.tenant_id,
    agentId: run.agent_id,
    workspaceId: run.workspace_id,
    planId: parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id,
    stepIndex: next.step_index,
    runId: run.run_id,
    jobId: run.job_id,
    stepId: next.step_id,
    key: run.key,
    lane: run.lane,
    workerId,
  };
}
