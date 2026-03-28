import type { SqlDb } from "../../../statestore/types.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { Logger } from "../../observability/logger.js";
import { resolveBuiltinToolEffect } from "../../agent/tools.js";
import { toolCallFromAction } from "./tool-call.js";
import type {
  AttemptOutcome,
  AttemptPolicyContext,
  PreparedAttemptResult,
} from "./attempt-runner-types.js";
import type { ExecuteAttemptOptions } from "./attempt-runner-types.js";

export interface AttemptPolicyDeps {
  db: SqlDb;
  policyService?: PolicyService;
  resolveSecretScopesFromArgs: (
    tenantId: string,
    args: Record<string, unknown>,
    scope: { runId: string; stepId: string; attemptId: string },
  ) => Promise<string[]>;
}

export async function persistAttemptPolicyContext(
  deps: AttemptPolicyDeps,
  opts: AttemptPolicyContext,
): Promise<void> {
  if (opts.action.type === "Decide") {
    return;
  }

  const run = await deps.db.get<{ policy_snapshot_id: string | null }>(
    "SELECT policy_snapshot_id FROM turns WHERE tenant_id = ? AND turn_id = ?",
    [opts.tenantId, opts.runId],
  );
  const policySnapshotId = run?.policy_snapshot_id?.trim() ?? "";
  if (!policySnapshotId) return;

  await deps.db.run(
    "UPDATE execution_attempts SET policy_snapshot_id = ? WHERE tenant_id = ? AND attempt_id = ?",
    [policySnapshotId, opts.tenantId, opts.attemptId],
  );
  if (!deps.policyService) return;

  const tool = toolCallFromAction(opts.action);
  const secretScopes = await deps.resolveSecretScopesFromArgs(
    opts.tenantId,
    opts.action.args ?? {},
    { runId: opts.runId, stepId: opts.stepId, attemptId: opts.attemptId },
  );
  const evaluation = await deps.policyService.evaluateToolCallFromSnapshot({
    tenantId: opts.tenantId,
    policySnapshotId,
    agentId: opts.agentId,
    workspaceId: opts.workspaceId,
    toolId: tool.toolId,
    toolMatchTarget: tool.matchTarget,
    url: tool.url,
    secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
    inputProvenance: { source: "workflow", trusted: true },
    toolEffect: resolveBuiltinToolEffect(tool.toolId),
  });

  await deps.db.run(
    `UPDATE execution_attempts
     SET policy_decision_json = ?, policy_applied_override_ids_json = ?
     WHERE tenant_id = ? AND attempt_id = ?`,
    [
      JSON.stringify(evaluation.decision_record ?? { decision: evaluation.decision, rules: [] }),
      JSON.stringify(evaluation.applied_override_ids ?? []),
      opts.tenantId,
      opts.attemptId,
    ],
  );
}

export function logAttemptStart(logger: Logger | undefined, opts: ExecuteAttemptOptions): void {
  logger?.info("execution.attempt.start", {
    plan_id: opts.planId,
    job_id: opts.jobId,
    run_id: opts.runId,
    step_id: opts.stepId,
    attempt_id: opts.attemptId,
    attempt: opts.attemptNum,
    key: opts.key,
    worker_id: opts.workerId,
    step_index: opts.stepIndex,
    action_type: opts.action.type,
  });
}

export function logAttemptOutcome(
  logger: Logger | undefined,
  opts: ExecuteAttemptOptions,
  prepared: PreparedAttemptResult,
  outcome: AttemptOutcome,
): void {
  const base = {
    job_id: opts.jobId,
    run_id: opts.runId,
    step_id: opts.stepId,
    attempt_id: opts.attemptId,
  };
  switch (outcome.kind) {
    case "paused":
      logger?.info("execution.attempt.paused", {
        ...base,
        reason: outcome.reason,
        approval_id: outcome.approvalId,
      });
      return;
    case "succeeded":
      logger?.info("execution.attempt.succeeded", {
        ...base,
        status: "succeeded",
        duration_ms: prepared.wallDurationMs,
        cost: prepared.cost,
      });
      return;
    case "cancelled":
      logger?.info("execution.attempt.cancelled", { ...base, status: "cancelled" });
      return;
    case "failed":
      logger?.info("execution.attempt.failed", {
        ...base,
        status: outcome.status,
        error: outcome.error,
        duration_ms: prepared.wallDurationMs,
        cost: prepared.cost,
      });
  }
}
