import type {
  ActionPrimitive as ActionPrimitiveT,
  Decision as DecisionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import { PolicyBundle, requiredCapability } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../../policy/domain.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import {
  releaseConcurrencySlotsTx,
  releaseLaneAndWorkspaceLeasesTx,
  releaseLaneLeaseTx,
  touchLaneLeaseTx,
  tryAcquireConcurrencyForAttemptTx,
} from "./concurrency-manager.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
import { toolCallFromAction } from "./tool-call.js";
import { releaseWorkspaceLeaseTx, tryAcquireWorkspaceLeaseTx } from "../../workspace/lease.js";
import {
  normalizeNonnegativeInt,
  type RunnableRunRow,
  type StepRow,
} from "./shared.js";
import type { ExecutionEngineApprovalManager } from "./approval-manager.js";
import type { ExecutionClock, ExecutionConcurrencyLimits } from "./types.js";

export type StepClaimOutcome =
  | { kind: "noop" }
  | { kind: "recovered" }
  | { kind: "finalized" }
  | { kind: "idempotent" }
  | { kind: "cancelled" }
  | { kind: "paused"; reason: "budget" | "policy" | "approval"; approvalId: string }
  | {
      kind: "claimed";
      tenantId: string;
      agentId: string;
      runId: string;
      jobId: string;
      workspaceId: string;
      key: string;
      lane: string;
      triggerJson: string;
      step: StepRow;
      attempt: {
        attemptId: string;
        attemptNum: number;
      };
    };

export interface StepExecutionClaimDeps {
  db: SqlDb;
  logger?: Logger;
  policyService?: PolicyService;
  approvalManager: ExecutionEngineApprovalManager;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  redactText(text: string): string;
  redactUnknown<T>(value: T): T;
  emitRunUpdatedTx(tx: SqlDb, runId: string): Promise<void>;
  emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void>;
  emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void>;
  emitRunStartedTx(tx: SqlDb, runId: string): Promise<void>;
  emitRunCompletedTx(tx: SqlDb, runId: string): Promise<void>;
  emitRunFailedTx(tx: SqlDb, runId: string): Promise<void>;
  isApprovedPolicyGateTx(
    tx: SqlDb,
    tenantId: string,
    approvalId: string | null,
  ): Promise<boolean>;
  resolveSecretScopesFromArgs(
    tenantId: string,
    args: unknown,
    context?: { runId?: string; stepId?: string; attemptId?: string },
  ): Promise<string[]>;
  maybePauseForToolIntentGuardrailTx(
    tx: SqlDb,
    opts: {
      run: RunnableRunRow;
      step: StepRow;
      actionType: ActionPrimitiveT["type"] | undefined;
      action: ActionPrimitiveT | undefined;
      clock: ExecutionClock;
      workerId: string;
    },
  ): Promise<{ approvalId: string } | undefined>;
}

export async function claimStepExecution(
  deps: StepExecutionClaimDeps,
  run: RunnableRunRow,
  workerId: string,
  clock: ExecutionClock,
): Promise<StepClaimOutcome> {
  return await deps.db.transaction(async (tx) => {
    const current = await tx.get<{
      run_status: string;
      job_status: string;
      started_at: string | Date | null;
    }>(
      `SELECT r.status AS run_status, j.status AS job_status, r.started_at AS started_at
       FROM execution_runs r
       JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.tenant_id = ? AND r.run_id = ?`,
      [run.tenant_id, run.run_id],
    );
    if (!current) {
      return { kind: "noop" };
    }
    if (current.run_status === "cancelled" || current.job_status === "cancelled") {
      await releaseLaneAndWorkspaceLeasesTx(tx, {
        tenantId: run.tenant_id,
        key: run.key,
        lane: run.lane,
        workspaceId: run.workspace_id,
        owner: workerId,
      });
      return { kind: "cancelled" };
    }

    if (run.status === "queued") {
      const shouldEmitRunStarted = current.started_at === null;
      const updated = await tx.run(
        `UPDATE execution_runs
         SET status = 'running', started_at = COALESCE(started_at, ?)
         WHERE tenant_id = ? AND run_id = ? AND status = 'queued'`,
        [clock.nowIso, run.tenant_id, run.run_id],
      );
      if (updated.changes === 1) {
        await deps.emitRunUpdatedTx(tx, run.run_id);
        if (shouldEmitRunStarted) {
          await deps.emitRunStartedTx(tx, run.run_id);
        }
      }
    }

    await tx.run(
      `UPDATE execution_jobs
       SET status = 'running'
       WHERE tenant_id = ? AND job_id = ? AND status = 'queued'`,
      [run.tenant_id, run.job_id],
    );

    const next = await tx.get<StepRow>(
      `SELECT
         tenant_id,
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         created_at,
         idempotency_key,
         postcondition_json,
         approval_id,
         max_attempts,
         timeout_ms
       FROM execution_steps
       WHERE tenant_id = ? AND run_id = ? AND status IN ('queued', 'running', 'paused')
       ORDER BY step_index ASC
       LIMIT 1`,
      [run.tenant_id, run.run_id],
    );

    if (!next) {
      const statuses = await tx.all<{ status: string }>(
        "SELECT status FROM execution_steps WHERE tenant_id = ? AND run_id = ?",
        [run.tenant_id, run.run_id],
      );
      const failed = statuses.some((s) => s.status === "failed" || s.status === "cancelled");

      const runUpdated = await tx.run(
        `UPDATE execution_runs
         SET status = ?, finished_at = ?
         WHERE tenant_id = ? AND run_id = ? AND status IN ('running', 'queued')`,
        [failed ? "failed" : "succeeded", clock.nowIso, run.tenant_id, run.run_id],
      );
      await deps.emitRunUpdatedTx(tx, run.run_id);
      if (runUpdated.changes === 1) {
        if (failed) {
          await deps.emitRunFailedTx(tx, run.run_id);
        } else {
          await deps.emitRunCompletedTx(tx, run.run_id);
        }
      }

      await tx.run(
        `UPDATE execution_jobs
         SET status = ?
         WHERE tenant_id = ? AND job_id = ? AND status IN ('queued', 'running')`,
        [failed ? "failed" : "completed", run.tenant_id, run.job_id],
      );
      await releaseLaneAndWorkspaceLeasesTx(tx, {
        tenantId: run.tenant_id,
        key: run.key,
        lane: run.lane,
        workspaceId: run.workspace_id,
        owner: workerId,
      });

      return { kind: "finalized" };
    }

    if (next.status === "paused") {
      return { kind: "noop" };
    }

    if (next.status === "running") {
      const latestAttempt = await tx.get<{
        attempt_id: string;
        lease_expires_at_ms: number | null;
      }>(
        `SELECT attempt_id, lease_expires_at_ms
         FROM execution_attempts
         WHERE tenant_id = ? AND step_id = ? AND status = 'running'
         ORDER BY attempt DESC
         LIMIT 1`,
        [next.tenant_id, next.step_id],
      );

      const expiresAtMs = latestAttempt?.lease_expires_at_ms ?? 0;
      if (latestAttempt && expiresAtMs <= clock.nowMs) {
        await tx.run(
          `UPDATE execution_attempts
           SET status = 'cancelled', finished_at = ?, error = ?
           WHERE tenant_id = ? AND attempt_id = ? AND status = 'running'`,
          [clock.nowIso, "lease expired; takeover", next.tenant_id, latestAttempt.attempt_id],
        );

        await tx.run(
          `UPDATE execution_steps
           SET status = 'queued'
           WHERE tenant_id = ? AND step_id = ? AND status = 'running'`,
          [next.tenant_id, next.step_id],
        );
        await deps.emitAttemptUpdatedTx(tx, latestAttempt.attempt_id);
        await releaseConcurrencySlotsTx(
          tx,
          next.tenant_id,
          latestAttempt.attempt_id,
          clock.nowIso,
          deps.concurrencyLimits,
        );
        await deps.emitStepUpdatedTx(tx, next.step_id);
        return { kind: "recovered" };
      }

      return { kind: "noop" };
    }

    const budgetRow = await tx.get<{
      budgets_json: string | null;
      budget_overridden_at: string | Date | null;
      started_at: string | Date | null;
      policy_snapshot_id: string | null;
    }>(
      `SELECT budgets_json, budget_overridden_at, started_at, policy_snapshot_id
       FROM execution_runs
       WHERE tenant_id = ? AND run_id = ?`,
      [run.tenant_id, run.run_id],
    );

    const budgetsRaw = safeJsonParse(budgetRow?.budgets_json ?? null, undefined as unknown);
    const budgets =
      budgetsRaw && typeof budgetsRaw === "object"
        ? (budgetsRaw as Record<string, unknown>)
        : undefined;
    const budgetOverridden = Boolean(budgetRow?.budget_overridden_at);

    if (budgets && !budgetOverridden) {
      const maxUsdMicros = normalizeNonnegativeInt(budgets["max_usd_micros"]);
      const maxDurationMs = normalizePositiveInt(budgets["max_duration_ms"]);
      const maxTotalTokens = normalizeNonnegativeInt(budgets["max_total_tokens"]);

      const startedAtIso = normalizeDbDateTime(budgetRow?.started_at ?? null);
      const startedAtMs = startedAtIso ? Date.parse(startedAtIso) : NaN;
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
        if (!cost || typeof cost !== "object") continue;
        const c = cost as Record<string, unknown>;
        spentUsdMicros += normalizeNonnegativeInt(c["usd_micros"]) ?? 0;
        const totalTokens =
          normalizeNonnegativeInt(c["total_tokens"]) ??
          (normalizeNonnegativeInt(c["input_tokens"]) ?? 0) +
            (normalizeNonnegativeInt(c["output_tokens"]) ?? 0);
        spentTotalTokens += totalTokens;
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

      if (reasons.length > 0) {
        const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
        const paused = await deps.approvalManager.pauseRunForApproval(
          tx,
          {
            tenantId: run.tenant_id,
            agentId: run.agent_id,
            workspaceId: run.workspace_id,
            planId,
            stepIndex: next.step_index,
            runId: run.run_id,
            jobId: run.job_id,
            stepId: next.step_id,
            key: run.key,
            lane: run.lane,
            workerId,
          },
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
        return {
          kind: "paused",
          reason: "budget",
          approvalId: paused.approvalId,
        };
      }
    }

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

    const policySnapshotId = budgetRow?.policy_snapshot_id ?? null;
    if (policySnapshotId) {
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
          policyBundle = undefined;
          deps.logger?.warn("execution.policy_snapshot_invalid", {
            run_id: run.run_id,
            step_id: next.step_id,
            policy_snapshot_id: policySnapshotId,
            error: message,
          });
        }
      }

      if (parsedAction) {
        const tool = toolCallFromAction(parsedAction);
        const toolId = tool.toolId;
        const toolMatchTarget = tool.matchTarget;
        const url = tool.url;

        const decision: DecisionT = await (async () => {
          if (snapshotState === "invalid") {
            if (deps.policyService?.isEnabled() && deps.policyService.isObserveOnly()) {
              return "allow";
            }
            return "require_approval";
          }

          if (deps.policyService?.isEnabled()) {
            const evaluation = await deps.policyService.evaluateToolCallFromSnapshot({
              tenantId: run.tenant_id,
              policySnapshotId,
              agentId: run.agent_id,
              workspaceId: run.workspace_id,
              toolId,
              toolMatchTarget,
              url,
              inputProvenance: { source: "workflow", trusted: true },
            });
            return deps.policyService.isObserveOnly() ? "allow" : evaluation.decision;
          }

          if (snapshotState === "missing" || !policyBundle) {
            return "require_approval";
          }

          const toolsDomain = normalizeDomain(policyBundle.tools, "require_approval");
          const egressDomain = normalizeDomain(policyBundle.network_egress, "require_approval");
          const toolDecision = evaluateDomain(toolsDomain, toolId);
          const egressDecision: DecisionT = url
            ? (() => {
                const normalizedUrl = normalizeUrlForPolicy(url);
                if (normalizedUrl.length === 0) return "allow";
                return evaluateDomain(egressDomain, normalizedUrl);
              })()
            : "allow";

          return mostRestrictiveDecision(toolDecision, egressDecision);
        })();

        if (decision === "deny") {
          const updated = await tx.run(
            `UPDATE execution_steps
             SET status = 'failed'
             WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
            [next.tenant_id, next.step_id],
          );

          if (updated.changes === 1) {
            const attemptAgg = await tx.get<{ n: number }>(
              `SELECT COALESCE(MAX(attempt), 0) AS n
               FROM execution_attempts
               WHERE tenant_id = ? AND step_id = ?`,
              [next.tenant_id, next.step_id],
            );
            const attemptNum = (attemptAgg?.n ?? 0) + 1;
            const attemptId = randomUUID();

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
                deps.redactText(`policy denied ${toolId}`).trim() || "policy denied",
                JSON.stringify(
                  deps.redactUnknown({
                    policy_snapshot_id: policySnapshotId,
                    tool_id: toolId,
                    tool_match_target: toolMatchTarget,
                    url,
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

          return { kind: "noop" };
        }

        if (decision === "require_approval") {
          const alreadyApproved = await deps.isApprovedPolicyGateTx(
            tx,
            run.tenant_id,
            next.approval_id,
          );

          if (!alreadyApproved) {
            const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
            const paused = await deps.approvalManager.pauseRunForApproval(
              tx,
              {
                tenantId: run.tenant_id,
                agentId: run.agent_id,
                workspaceId: run.workspace_id,
                planId,
                stepIndex: next.step_index,
                runId: run.run_id,
                jobId: run.job_id,
                stepId: next.step_id,
                key: run.key,
                lane: run.lane,
                workerId,
              },
              {
                kind: "policy",
                prompt: "Policy approval required to continue execution",
                detail: `policy requires approval for '${toolId}' (${toolMatchTarget || "unknown"})`,
                context: {
                  source: "execution-engine",
                  policy_snapshot_id: policySnapshotId,
                  tool_id: toolId,
                  tool_match_target: toolMatchTarget,
                  url,
                  decision,
                },
              },
            );
            return {
              kind: "paused",
              reason: "policy",
              approvalId: paused.approvalId,
            };
          }
        }
      }
    }

    const attemptAgg = await tx.get<{ n: number }>(
      `SELECT COALESCE(MAX(attempt), 0) AS n
       FROM execution_attempts
       WHERE tenant_id = ? AND step_id = ?`,
      [next.tenant_id, next.step_id],
    );
    const attemptNum = (attemptAgg?.n ?? 0) + 1;
    const attemptId = randomUUID();
    const leaseTtlMs = Math.max(30_000, next.timeout_ms + 10_000);

    if (next.idempotency_key) {
      const record = await tx.get<{ status: string; result_json: string | null }>(
        `SELECT status, result_json
         FROM idempotency_records
         WHERE tenant_id = ? AND scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
        [next.tenant_id, next.step_id, next.idempotency_key],
      );

      if (record?.status === "succeeded") {
        const updated = await tx.run(
          `UPDATE execution_steps
           SET status = 'succeeded'
           WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
          [next.tenant_id, next.step_id],
        );
        if (updated.changes === 1) {
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
              attemptId,
              next.step_id,
              attemptNum,
              clock.nowIso,
              clock.nowIso,
              run.policy_snapshot_id ?? null,
              record.result_json ?? null,
            ],
          );

          await deps.emitStepUpdatedTx(tx, next.step_id);
          await deps.emitAttemptUpdatedTx(tx, attemptId);
          return { kind: "idempotent" };
        }
      }
    }

    const toolIntentPause = await deps.maybePauseForToolIntentGuardrailTx(tx, {
      run,
      step: next,
      actionType,
      action: parsedAction,
      clock,
      workerId,
    });
    if (toolIntentPause) {
      return {
        kind: "paused",
        reason: "approval",
        approvalId: toolIntentPause.approvalId,
      };
    }

    const policy = deps.policyService;
    if (
      policy &&
      policy.isEnabled() &&
      !policy.isObserveOnly() &&
      parsedAction &&
      (actionType === "CLI" || actionType === "Http")
    ) {
      const secretScopes = await deps.resolveSecretScopesFromArgs(next.tenant_id, parsedAction.args ?? {}, {
        runId: run.run_id,
        stepId: next.step_id,
      });

      if (secretScopes.length > 0) {
        const secretsDecision = (
          await policy.evaluateSecretsFromSnapshot({
            tenantId: next.tenant_id,
            policySnapshotId: run.policy_snapshot_id,
            secretScopes,
          })
        ).decision;

        if (secretsDecision === "deny") {
          const stepFailed = await tx.run(
            `UPDATE execution_steps
             SET status = 'failed'
             WHERE tenant_id = ? AND step_id = ? AND status = 'queued'`,
            [next.tenant_id, next.step_id],
          );

          if (stepFailed.changes !== 1) {
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
               finished_at,
               policy_snapshot_id,
               artifacts_json,
               result_json,
               error
             ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, '[]', NULL, ?)`,
            [
              next.tenant_id,
              attemptId,
              next.step_id,
              attemptNum,
              clock.nowIso,
              clock.nowIso,
              run.policy_snapshot_id ?? null,
              deps.redactText(
                `policy denied secret resolution for scopes: ${secretScopes.join(", ")}`,
              ),
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

          await deps.emitAttemptUpdatedTx(tx, attemptId);
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

        if (secretsDecision === "require_approval") {
          const alreadyApproved = await deps.isApprovedPolicyGateTx(
            tx,
            run.tenant_id,
            next.approval_id,
          );
          if (!alreadyApproved) {
            const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
            const paused = await deps.approvalManager.pauseRunForApproval(
              tx,
              {
                tenantId: run.tenant_id,
                agentId: run.agent_id,
                workspaceId: run.workspace_id,
                planId,
                stepIndex: next.step_index,
                runId: run.run_id,
                jobId: run.job_id,
                stepId: next.step_id,
                key: run.key,
                lane: run.lane,
                workerId,
              },
              {
                kind: "policy",
                prompt: "Policy approval required — secret resolution",
                detail: `Step requires resolving ${String(secretScopes.length)} secret scope(s): ${secretScopes.join(", ")}`,
                context: {
                  action_type: actionType,
                  secret_scopes: secretScopes,
                  policy_snapshot_id: run.policy_snapshot_id ?? null,
                },
              },
            );
            return {
              kind: "paused",
              reason: "policy",
              approvalId: paused.approvalId,
            };
          }
        }
      }
    }

    const agentId = run.agent_id;
    const capability = actionType ? requiredCapability(actionType) : undefined;

    const concurrencyOk = await tryAcquireConcurrencyForAttemptTx(
      tx,
      {
        tenantId: run.tenant_id,
        attemptId,
        owner: workerId,
        nowMs: clock.nowMs,
        nowIso: clock.nowIso,
        ttlMs: leaseTtlMs,
        agentId,
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
        ttlMs: leaseTtlMs,
      });
      if (!workspaceOk) {
        await releaseConcurrencySlotsTx(
          tx,
          run.tenant_id,
          attemptId,
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
        attemptId,
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
        attemptId,
        next.step_id,
        attemptNum,
        clock.nowIso,
        run.policy_snapshot_id ?? null,
        workerId,
        clock.nowMs + leaseTtlMs,
      ],
    );

    await touchLaneLeaseTx(tx, {
      tenantId: run.tenant_id,
      key: run.key,
      lane: run.lane,
      owner: workerId,
      expiresAtMs: clock.nowMs + leaseTtlMs,
    });

    await deps.emitStepUpdatedTx(tx, next.step_id);
    await deps.emitAttemptUpdatedTx(tx, attemptId);
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
        attemptId,
        attemptNum,
      },
    };
  });
}
