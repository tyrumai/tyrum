import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  Decision as DecisionT,
  ClientCapability as ClientCapabilityT,
  ExecutionTrigger as ExecutionTriggerT,
  PolicyBundle as PolicyBundleT,
  WsEventEnvelope as WsEventEnvelopeT,
  WsRequestEnvelope as WsRequestEnvelopeT,
} from "@tyrum/schemas";
import {
  evaluatePostcondition,
  Lane,
  PolicyBundle,
  PostconditionError,
  requiredCapability,
  requiresPostcondition,
  TyrumKey,
} from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { RedactionEngine } from "../../redaction/engine.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import type { SecretProvider } from "../../secret/provider.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../../policy/domain.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { releaseLaneLease } from "../../lanes/lane-lease.js";
import { enqueueWsBroadcastMessage } from "../../../ws/outbox.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import { defaultClock } from "./clock.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import { parseConcurrencyLimitsFromEnv } from "./concurrency.js";
import { normalizeWorkspaceId, parsePlanIdFromTriggerJson } from "./db.js";
import type {
  ClockFn,
  EnqueuePlanInput,
  EnqueuePlanResult,
  ExecutionClock,
  ExecutionConcurrencyLimits,
  StepExecutionContext,
  StepExecutor,
  StepResult,
  WorkerTickInput,
} from "./types.js";

interface ResumeTokenRow {
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

interface RunnableRunRow {
  run_id: string;
  job_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
  workspace_id: string;
  policy_snapshot_id: string | null;
}

interface StepRow {
  step_id: string;
  run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: number | null;
  max_attempts: number;
  timeout_ms: number;
}

function normalizeNonnegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < 0) return undefined;
  return n;
}

export class ExecutionEngine {
  private readonly db: SqlDb;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly secretProvider?: SecretProvider;
  private readonly logger?: Logger;
  private readonly policyService?: PolicyService;
  private readonly eventsEnabled: boolean;
  private readonly concurrencyLimits?: ExecutionConcurrencyLimits;

  constructor(opts: {
    db: SqlDb;
    clock?: ClockFn;
    redactionEngine?: RedactionEngine;
    secretProvider?: SecretProvider;
    logger?: Logger;
    policyService?: PolicyService;
    eventsEnabled?: boolean;
    concurrencyLimits?: ExecutionConcurrencyLimits;
  }) {
    this.db = opts.db;
    this.clock = opts.clock ?? defaultClock;
    this.redactionEngine = opts.redactionEngine;
    this.secretProvider = opts.secretProvider;
    this.logger = opts.logger;
    this.policyService = opts.policyService;
    this.eventsEnabled = opts.eventsEnabled ?? true;
    this.concurrencyLimits = opts.concurrencyLimits ?? parseConcurrencyLimitsFromEnv(opts.logger);
  }

  private redactUnknown<T>(value: T): T {
    return this.redactionEngine ? (this.redactionEngine.redactUnknown(value).redacted as T) : value;
  }

  private redactText(text: string): string {
    return this.redactionEngine ? this.redactionEngine.redactText(text).redacted : text;
  }

  private async resolveSecretScopesFromArgs(args: unknown): Promise<string[]> {
    const handleIds = collectSecretHandleIds(args);
    if (handleIds.length === 0) return [];

    if (!this.secretProvider) {
      return handleIds;
    }

    try {
      const handles = await this.secretProvider.list();
      const byId = new Map(handles.map((h) => [h.handle_id, h]));
      const scopes = new Set<string>();

      for (const id of handleIds) {
        const handle = byId.get(id);
        if (handle?.scope) {
          scopes.add(`${handle.provider}:${handle.scope}`);
        } else {
          scopes.add(id);
        }
      }

      return [...scopes];
    } catch {
      return handleIds;
    }
  }

  private async isApprovedPolicyGateTx(tx: SqlDb, approvalId: number | null): Promise<boolean> {
    if (approvalId === null) return false;
    const row = await tx.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE id = ? LIMIT 1",
      [approvalId],
    );
    if (!row) return false;
    return row.kind === "policy" && row.status === "approved";
  }

  private async enqueueWsMessage(
    tx: SqlDb,
    message: WsEventEnvelopeT | WsRequestEnvelopeT,
  ): Promise<void> {
    if (!this.eventsEnabled) return;
    await enqueueWsBroadcastMessage(tx, message);
  }

  private async enqueueWsEvent(tx: SqlDb, evt: WsEventEnvelopeT): Promise<void> {
    await this.enqueueWsMessage(tx, evt);
  }

  private async emitRunUpdatedTx(tx: SqlDb, runId: string): Promise<void> {
    const row = await tx.get<{
      run_id: string;
      job_id: string;
      key: string;
      lane: string;
      status: string;
      attempt: number;
      created_at: string | Date;
      started_at: string | Date | null;
      finished_at: string | Date | null;
      paused_reason: string | null;
      paused_detail: string | null;
      policy_snapshot_id: string | null;
      budgets_json: string | null;
      budget_overridden_at: string | Date | null;
    }>(
      `SELECT
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         created_at,
         started_at,
         finished_at,
         paused_reason,
         paused_detail,
         policy_snapshot_id,
         budgets_json,
         budget_overridden_at
       FROM execution_runs
       WHERE run_id = ?`,
      [runId],
    );
    if (!row) return;

    const budgets = safeJsonParse(row.budgets_json, undefined as unknown);

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.updated",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: row.run_id },
      payload: {
        run: {
          run_id: row.run_id,
          job_id: row.job_id,
          key: row.key,
          lane: row.lane,
          status: row.status,
          attempt: row.attempt,
          created_at: normalizeDbDateTime(row.created_at) ?? this.clock().nowIso,
          started_at: normalizeDbDateTime(row.started_at),
          finished_at: normalizeDbDateTime(row.finished_at),
          paused_reason: row.paused_reason ?? undefined,
          paused_detail: row.paused_detail ?? undefined,
          policy_snapshot_id: row.policy_snapshot_id ?? undefined,
          budgets,
          budget_overridden_at: normalizeDbDateTime(row.budget_overridden_at),
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void> {
    const row = await tx.get<{
      step_id: string;
      run_id: string;
      step_index: number;
      status: string;
      action_json: string;
      created_at: string | Date;
      idempotency_key: string | null;
      postcondition_json: string | null;
      approval_id: number | null;
    }>(
      `SELECT
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         created_at,
         idempotency_key,
         postcondition_json,
         approval_id
       FROM execution_steps
       WHERE step_id = ?`,
      [stepId],
    );
    if (!row) return;

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "step.updated",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: row.run_id },
      payload: {
        step: {
          step_id: row.step_id,
          run_id: row.run_id,
          step_index: row.step_index,
          status: row.status,
          action: safeJsonParse(row.action_json, {}),
          created_at: normalizeDbDateTime(row.created_at) ?? this.clock().nowIso,
          idempotency_key: row.idempotency_key ?? undefined,
          postcondition: safeJsonParse(row.postcondition_json, undefined as unknown),
          approval_id: row.approval_id ?? undefined,
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void> {
    const row = await tx.get<{
      attempt_id: string;
      step_id: string;
      attempt: number;
      status: string;
      started_at: string | Date;
      finished_at: string | Date | null;
      result_json: string | null;
      error: string | null;
      postcondition_report_json: string | null;
      artifacts_json: string;
      cost_json: string | null;
      metadata_json: string | null;
      policy_snapshot_id: string | null;
      policy_decision_json: string | null;
      policy_applied_override_ids_json: string | null;
    }>(
      `SELECT
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         finished_at,
         result_json,
         error,
         postcondition_report_json,
         artifacts_json,
         cost_json,
         metadata_json,
         policy_snapshot_id,
         policy_decision_json,
         policy_applied_override_ids_json
       FROM execution_attempts
       WHERE attempt_id = ?`,
      [attemptId],
    );
    if (!row) return;

    const step = await tx.get<{ run_id: string }>(
      "SELECT run_id FROM execution_steps WHERE step_id = ?",
      [row.step_id],
    );

    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "attempt.updated",
      occurred_at: this.clock().nowIso,
      scope: step ? { kind: "run", run_id: step.run_id } : undefined,
      payload: {
        attempt: {
          attempt_id: row.attempt_id,
          step_id: row.step_id,
          attempt: row.attempt,
          status: row.status,
          started_at: normalizeDbDateTime(row.started_at) ?? this.clock().nowIso,
          finished_at: normalizeDbDateTime(row.finished_at),
          result: safeJsonParse(row.result_json, undefined as unknown),
          error: row.error,
          postcondition_report: safeJsonParse(row.postcondition_report_json, undefined as unknown),
          artifacts: safeJsonParse(row.artifacts_json, [] as unknown[]),
          cost: safeJsonParse(row.cost_json, undefined as unknown),
          metadata: safeJsonParse(row.metadata_json, undefined as unknown),
          policy_snapshot_id: row.policy_snapshot_id ?? undefined,
          policy_decision: safeJsonParse(row.policy_decision_json, undefined as unknown),
          policy_applied_override_ids: safeJsonParse(
            row.policy_applied_override_ids_json,
            undefined as unknown,
          ),
        },
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitArtifactCreatedTx(
    tx: SqlDb,
    opts: { runId: string; artifact: ArtifactRefT },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "artifact.created",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: { artifact: opts.artifact },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitArtifactAttachedTx(
    tx: SqlDb,
    opts: { runId: string; stepId: string; attemptId: string; artifact: ArtifactRefT },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "artifact.attached",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: {
        artifact: opts.artifact,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitRunPausedTx(
    tx: SqlDb,
    opts: {
      runId: string;
      reason: string;
      approvalId?: number;
      detail?: string;
    },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.paused",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: {
        run_id: opts.runId,
        reason: opts.reason,
        approval_id: opts.approvalId,
        detail: opts.detail,
      },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitRunResumedTx(tx: SqlDb, runId: string): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.resumed",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: runId },
      payload: { run_id: runId },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private async emitRunCancelledTx(
    tx: SqlDb,
    opts: { runId: string; reason?: string },
  ): Promise<void> {
    const evt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "run.cancelled",
      occurred_at: this.clock().nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: { run_id: opts.runId, reason: opts.reason },
    };
    await this.enqueueWsEvent(tx, evt);
  }

  private deriveAgentIdFromKey(key: string): string | null {
    if (!key.startsWith("agent:")) return null;
    const parts = key.split(":");
    const agentId = parts.length > 1 ? parts[1] : undefined;
    return agentId && agentId.trim().length > 0 ? agentId : null;
  }

  private async recordArtifactsTx(
    tx: SqlDb,
    scope: {
      runId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      key: string;
    },
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    if (artifacts.length === 0) return;

    const agentId = this.deriveAgentIdFromKey(scope.key);
    const run = await tx.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE run_id = ?",
      [scope.runId],
    );
    const policySnapshotId = run?.policy_snapshot_id ?? null;

    for (const artifact of artifacts) {
      const labelsJson = JSON.stringify(this.redactUnknown(artifact.labels ?? []));
      const metadataJson = JSON.stringify(this.redactUnknown(artifact.metadata ?? {}));

      const insertResult = await tx.run(
        `INSERT INTO execution_artifacts (
           artifact_id,
           workspace_id,
           agent_id,
           run_id,
           step_id,
           attempt_id,
           kind,
           uri,
           created_at,
           mime_type,
           size_bytes,
           sha256,
           labels_json,
           metadata_json,
           sensitivity,
           policy_snapshot_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (artifact_id) DO NOTHING`,
        [
          artifact.artifact_id,
          scope.workspaceId,
          agentId,
          scope.runId,
          scope.stepId,
          scope.attemptId,
          artifact.kind,
          artifact.uri,
          artifact.created_at,
          artifact.mime_type ?? null,
          artifact.size_bytes ?? null,
          artifact.sha256 ?? null,
          labelsJson,
          metadataJson,
          "normal",
          policySnapshotId,
        ],
      );

      if (insertResult.changes > 0) {
        await this.emitArtifactCreatedTx(tx, { runId: scope.runId, artifact });
      }
      await this.emitArtifactAttachedTx(tx, {
        runId: scope.runId,
        stepId: scope.stepId,
        attemptId: scope.attemptId,
        artifact,
      });
    }
  }

  async enqueuePlanInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    const jobId = randomUUID();
    const runId = randomUUID();
    const workspaceId = normalizeWorkspaceId(input.workspaceId);

    const baseMetadata = {
      plan_id: input.planId,
      request_id: input.requestId,
    };

    const normalizeTriggerKind = (value: unknown): ExecutionTriggerT["kind"] => {
      const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (
        normalized === "session" ||
        normalized === "cron" ||
        normalized === "heartbeat" ||
        normalized === "hook" ||
        normalized === "webhook" ||
        normalized === "manual" ||
        normalized === "api"
      ) {
        return normalized;
      }
      return "session";
    };

    const trigger = (() => {
      if (!input.trigger) {
        return {
          kind: "session",
          key: input.key,
          lane: input.lane,
          metadata: baseMetadata,
        };
      }

      const provided = input.trigger as Record<string, unknown>;
      const metadata =
        provided["metadata"] &&
        typeof provided["metadata"] === "object" &&
        !Array.isArray(provided["metadata"])
          ? { ...(provided["metadata"] as Record<string, unknown>), ...baseMetadata }
          : baseMetadata;

      const kind = normalizeTriggerKind(provided["kind"]);

      return {
        ...provided,
        kind,
        key: typeof provided["key"] === "string" ? provided["key"] : input.key,
        lane: typeof provided["lane"] === "string" ? provided["lane"] : input.lane,
        metadata,
      };
    })();

    const triggerJson = JSON.stringify(trigger);
    const inputJson = JSON.stringify({
      plan_id: input.planId,
      request_id: input.requestId,
    });

    await tx.run(
      `INSERT INTO execution_jobs (
         job_id,
         key,
         lane,
         status,
         trigger_json,
         input_json,
         latest_run_id,
         policy_snapshot_id,
         workspace_id
       )
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      [
        jobId,
        input.key,
        input.lane,
        triggerJson,
        inputJson,
        runId,
        input.policySnapshotId ?? null,
        workspaceId,
      ],
    );

    await tx.run(
      `INSERT INTO execution_runs (
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         policy_snapshot_id,
         budgets_json
       )
       VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)`,
      [
        runId,
        jobId,
        input.key,
        input.lane,
        input.policySnapshotId ?? null,
        input.budgets ? JSON.stringify(input.budgets) : null,
      ],
    );

    for (let idx = 0; idx < input.steps.length; idx += 1) {
      const stepId = randomUUID();
      const action = input.steps[idx]!;
      await tx.run(
        `INSERT INTO execution_steps (
           step_id,
           run_id,
           step_index,
           status,
           action_json,
           idempotency_key,
           postcondition_json
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
        [
          stepId,
          runId,
          idx,
          JSON.stringify(action),
          action.idempotency_key ?? null,
          action.postcondition ? JSON.stringify(action.postcondition) : null,
        ],
      );
    }

    await this.emitRunUpdatedTx(tx, runId);
    const stepIds = await tx.all<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
      [runId],
    );
    for (const row of stepIds) {
      await this.emitStepUpdatedTx(tx, row.step_id);
    }
    return { jobId, runId };
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    const res = await this.db.transaction(async (tx) => {
      return await this.enqueuePlanInTx(tx, input);
    });

    this.logger?.info("execution.enqueue", {
      request_id: input.requestId,
      plan_id: input.planId,
      job_id: res.jobId,
      run_id: res.runId,
      key: input.key,
      lane: input.lane,
      steps_count: input.steps.length,
    });
    return res;
  }

  /**
   * Resume a paused run using an opaque token.
   *
   * Returns the resumed run id on success, otherwise `undefined`.
   */
  async resumeRun(token: string): Promise<string | undefined> {
    const { nowIso } = this.clock();
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<ResumeTokenRow>(
        `SELECT token, run_id, expires_at, revoked_at
         FROM resume_tokens
         WHERE token = ?`,
        [token],
      );
      if (!row) return undefined;
      if (row.revoked_at) return undefined;

      if (row.expires_at) {
        const expiresAtMs =
          row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at);
        if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          // Expired token; revoke so it can't be replayed.
          await tx.run(
            `UPDATE resume_tokens
             SET revoked_at = ?
             WHERE token = ? AND revoked_at IS NULL`,
            [nowIso, token],
          );
          return undefined;
        }
      }

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE token = ? AND revoked_at IS NULL`,
        [nowIso, token],
      );

      const approval = await tx.get<{ kind: string }>(
        "SELECT kind FROM approvals WHERE resume_token = ? LIMIT 1",
        [token],
      );
      const runResumed = await tx.run(
        `UPDATE execution_runs
         SET status = 'queued', paused_reason = NULL, paused_detail = NULL
         WHERE run_id = ? AND status = 'paused'`,
        [row.run_id],
      );
      if (runResumed.changes !== 1) {
        return undefined;
      }

      if (approval?.kind === "budget") {
        await tx.run(
          `UPDATE execution_runs
           SET budget_overridden_at = COALESCE(budget_overridden_at, ?)
           WHERE run_id = ?`,
          [nowIso, row.run_id],
        );
      }

      await tx.run(
        `UPDATE execution_steps
         SET status = 'queued'
         WHERE run_id = ? AND status = 'paused'`,
        [row.run_id],
      );

      await this.emitRunUpdatedTx(tx, row.run_id);
      const stepIds = await tx.all<{ step_id: string }>(
        "SELECT step_id FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
        [row.run_id],
      );
      for (const step of stepIds) {
        await this.emitStepUpdatedTx(tx, step.step_id);
      }

      await this.emitRunResumedTx(tx, row.run_id);

      return row.run_id;
    });
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    const { nowIso } = this.clock();
    const detail = reason ? this.redactText(reason) : null;

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<{ run_id: string; status: string; job_id: string }>(
        `SELECT run_id, status, job_id
         FROM execution_runs
         WHERE run_id = ?`,
        [runId],
      );
      if (!row) return "not_found";

      if (row.status === "cancelled") {
        await tx.run(
          `UPDATE resume_tokens
           SET revoked_at = ?
           WHERE run_id = ? AND revoked_at IS NULL`,
          [nowIso, runId],
        );
        return "cancelled";
      }
      if (row.status === "succeeded" || row.status === "failed") {
        return "already_terminal";
      }

      await tx.run(
        `UPDATE execution_runs
         SET status = 'cancelled',
             finished_at = COALESCE(finished_at, ?),
             paused_reason = COALESCE(paused_reason, 'cancelled'),
             paused_detail = COALESCE(paused_detail, ?)
         WHERE run_id = ?`,
        [nowIso, detail, runId],
      );

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'cancelled'
         WHERE job_id = ?`,
        [row.job_id],
      );

      await tx.run(
        `UPDATE execution_steps
         SET status = 'cancelled'
         WHERE run_id = ?
           AND status IN ('queued', 'paused', 'running')`,
        [runId],
      );

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE run_id = ? AND revoked_at IS NULL`,
        [nowIso, runId],
      );

      // Best-effort: mark any in-flight attempts as cancelled so they don't linger.
      const runningAttempts = await tx.all<{ attempt_id: string }>(
        `SELECT a.attempt_id
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         WHERE s.run_id = ? AND a.status = 'running'`,
        [runId],
      );
      await tx.run(
        `UPDATE execution_attempts
         SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = COALESCE(error, 'cancelled')
         WHERE status = 'running'
           AND step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?)`,
        [nowIso, runId],
      );

      for (const attempt of runningAttempts) {
        await this.releaseConcurrencySlotsTx(tx, attempt.attempt_id, nowIso);
      }

      await this.emitRunUpdatedTx(tx, runId);
      const stepIds = await tx.all<{ step_id: string }>(
        "SELECT step_id FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
        [runId],
      );
      for (const step of stepIds) {
        await this.emitStepUpdatedTx(tx, step.step_id);
      }
      for (const attempt of runningAttempts) {
        await this.emitAttemptUpdatedTx(tx, attempt.attempt_id);
      }

      await this.emitRunCancelledTx(tx, { runId, reason: detail ?? undefined });

      return "cancelled";
    });
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();

    const runIdFilter = input.runId?.trim();
    const whereRunId = runIdFilter ? " AND r.run_id = ?" : "";
    const params = runIdFilter ? [runIdFilter] : [];
    const limit = runIdFilter ? 1 : 10;

    const candidates = await this.db.all<RunnableRunRow>(
      `SELECT
         r.run_id,
         r.job_id,
         r.key,
         r.lane,
         r.status,
         j.trigger_json,
         j.workspace_id,
         r.policy_snapshot_id
       FROM execution_runs r
       JOIN execution_jobs j ON j.job_id = r.job_id
       WHERE r.status IN ('running', 'queued')
         AND NOT EXISTS (
           SELECT 1 FROM execution_runs p
           WHERE p.key = r.key AND p.lane = r.lane AND p.status = 'paused'
         )
         ${whereRunId}
       ORDER BY
         CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
         r.created_at ASC
       LIMIT ${String(limit)}`,
      params,
    );

    for (const run of candidates) {
      const leaseOk = await this.tryAcquireLaneLease({
        key: run.key,
        lane: run.lane,
        owner: input.workerId,
        nowMs,
        ttlMs: 60_000,
      });
      if (!leaseOk) continue;

      const workspaceOk = await this.tryAcquireWorkspaceLease({
        workspaceId: run.workspace_id,
        owner: input.workerId,
        nowMs,
        ttlMs: 5_000,
      });
      if (!workspaceOk) {
        await releaseLaneLease(this.db, {
          key: run.key,
          lane: run.lane,
          owner: input.workerId,
        });
        continue;
      }

      try {
        const didWork = await this.tickWithLaneLease(run, input, { nowMs, nowIso });
        if (didWork) return true;
      } finally {
        // Lane leases are held across the whole run while it's active.
        // The tick function releases on completion/failure. On transient
        // errors we still keep the lease for a short TTL to reduce stampedes.
      }
    }

    return false;
  }

  private async tickWithLaneLease(
    run: RunnableRunRow,
    input: WorkerTickInput,
    clock: ExecutionClock,
  ): Promise<boolean> {
    const outcome = await this.db.transaction(async (tx) => {
      const current = await tx.get<{ run_status: string; job_status: string }>(
        `SELECT r.status AS run_status, j.status AS job_status
         FROM execution_runs r
         JOIN execution_jobs j ON j.job_id = r.job_id
         WHERE r.run_id = ?`,
        [run.run_id],
      );
      if (!current) {
        return { kind: "noop" as const };
      }
      if (current.run_status === "cancelled" || current.job_status === "cancelled") {
        await tx.run(
          `DELETE FROM lane_leases
           WHERE key = ? AND lane = ? AND lease_owner = ?`,
          [run.key, run.lane, input.workerId],
        );
        await tx.run(
          `DELETE FROM workspace_leases
           WHERE workspace_id = ? AND lease_owner = ?`,
          [run.workspace_id, input.workerId],
        );
        return { kind: "cancelled" as const };
      }

      if (run.status === "queued") {
        const updated = await tx.run(
          `UPDATE execution_runs
           SET status = 'running', started_at = ?
           WHERE run_id = ? AND status = 'queued'`,
          [clock.nowIso, run.run_id],
        );
        if (updated.changes === 1) {
          await this.emitRunUpdatedTx(tx, run.run_id);
        }
      }

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'running'
         WHERE job_id = ? AND status = 'queued'`,
        [run.job_id],
      );

      // Find next incomplete step.
      const next = await tx.get<StepRow>(
        `SELECT
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
         WHERE run_id = ? AND status IN ('queued', 'running', 'paused')
         ORDER BY step_index ASC
         LIMIT 1`,
        [run.run_id],
      );

      if (!next) {
        // Finalize run if all steps are terminal.
        const statuses = await tx.all<{ status: string }>(
          "SELECT status FROM execution_steps WHERE run_id = ?",
          [run.run_id],
        );
        const failed = statuses.some((s) => s.status === "failed" || s.status === "cancelled");

        await tx.run(
          `UPDATE execution_runs
           SET status = ?, finished_at = ?
           WHERE run_id = ? AND status IN ('running', 'queued')`,
          [failed ? "failed" : "succeeded", clock.nowIso, run.run_id],
        );
        await this.emitRunUpdatedTx(tx, run.run_id);

        await tx.run(
          `UPDATE execution_jobs
           SET status = ?
           WHERE job_id = ? AND status IN ('queued', 'running')`,
          [failed ? "failed" : "completed", run.job_id],
        );

        await tx.run(
          `DELETE FROM lane_leases
           WHERE key = ? AND lane = ? AND lease_owner = ?`,
          [run.key, run.lane, input.workerId],
        );

        await tx.run(
          `DELETE FROM workspace_leases
           WHERE workspace_id = ? AND lease_owner = ?`,
          [run.workspace_id, input.workerId],
        );

        return { kind: "finalized" as const };
      }

      if (next.status === "paused") {
        return { kind: "noop" as const };
      }

      if (next.status === "running") {
        // Stale attempt takeover: if a prior worker crashed mid-step,
        // cancel the stale attempt and re-queue the step.
        const latestAttempt = await tx.get<{
          attempt_id: string;
          lease_expires_at_ms: number | null;
        }>(
          `SELECT attempt_id, lease_expires_at_ms
           FROM execution_attempts
           WHERE step_id = ? AND status = 'running'
           ORDER BY attempt DESC
           LIMIT 1`,
          [next.step_id],
        );

        const expiresAtMs = latestAttempt?.lease_expires_at_ms ?? 0;
        if (latestAttempt && expiresAtMs <= clock.nowMs) {
          await tx.run(
            `UPDATE execution_attempts
             SET status = 'cancelled', finished_at = ?, error = ?
             WHERE attempt_id = ? AND status = 'running'`,
            [clock.nowIso, "lease expired; takeover", latestAttempt.attempt_id],
          );

          await tx.run(
            `UPDATE execution_steps
             SET status = 'queued'
             WHERE step_id = ? AND status = 'running'`,
            [next.step_id],
          );
          await this.emitAttemptUpdatedTx(tx, latestAttempt.attempt_id);
          await this.releaseConcurrencySlotsTx(tx, latestAttempt.attempt_id, clock.nowIso);
          await this.emitStepUpdatedTx(tx, next.step_id);
          return { kind: "recovered" as const };
        }

        return { kind: "noop" as const };
      }

      // Enforce optional run budgets before starting the next queued step.
      const budgetRow = await tx.get<{
        budgets_json: string | null;
        budget_overridden_at: string | Date | null;
        started_at: string | Date | null;
        policy_snapshot_id: string | null;
      }>(
        `SELECT budgets_json, budget_overridden_at, started_at, policy_snapshot_id
         FROM execution_runs
         WHERE run_id = ?`,
        [run.run_id],
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
           JOIN execution_steps s ON s.step_id = a.step_id
           WHERE s.run_id = ? AND a.cost_json IS NOT NULL`,
          [run.run_id],
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
          reasons.push(
            `elapsed_ms=${String(elapsedMs)} > max_duration_ms=${String(maxDurationMs)}`,
          );
        }

        if (reasons.length > 0) {
          const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
          const paused = await this.pauseRunForApproval(
            tx,
            {
              planId,
              stepIndex: next.step_index,
              runId: run.run_id,
              jobId: run.job_id,
              stepId: next.step_id,
              workspaceId: run.workspace_id,
              key: run.key,
              lane: run.lane,
              workerId: input.workerId,
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
            kind: "paused" as const,
            reason: "budget" as const,
            approvalId: paused.approvalId,
          };
        }
      }

      // Enforce per-step policy decisions when a run carries a snapshot.
      const policySnapshotId = budgetRow?.policy_snapshot_id ?? null;
      if (policySnapshotId) {
        const policyRow = await tx.get<{ bundle_json: string }>(
          "SELECT bundle_json FROM policy_snapshots WHERE policy_snapshot_id = ?",
          [policySnapshotId],
        );
        let snapshotState: "valid" | "missing" | "invalid" = "missing";
        let policyBundle: PolicyBundleT | undefined;

        if (policyRow?.bundle_json) {
          try {
            policyBundle = PolicyBundle.parse(JSON.parse(policyRow.bundle_json) as unknown);
            snapshotState = "valid";
          } catch {
            snapshotState = "invalid";
            policyBundle = undefined;
          }
        }

        let parsedAction: ActionPrimitiveT | undefined;
        try {
          parsedAction = JSON.parse(next.action_json) as ActionPrimitiveT;
        } catch {
          parsedAction = undefined;
        }

        if (parsedAction) {
          const tool = this.toolCallFromAction(parsedAction);
          const toolId = tool.toolId;
          const toolMatchTarget = tool.matchTarget;
          const url = tool.url;

          const decision: DecisionT = await (async () => {
            if (snapshotState === "invalid") {
              // Fail closed: if we can't parse the stored snapshot, do not allow overrides to auto-allow.
              // Observe-only deployments keep their non-blocking behavior.
              if (this.policyService?.isEnabled() && this.policyService.isObserveOnly()) {
                return "allow";
              }
              return "require_approval";
            }

            if (this.policyService?.isEnabled()) {
              const agentId = this.deriveAgentIdFromKey(run.key) ?? "default";
              const evaluation = await this.policyService.evaluateToolCallFromSnapshot({
                policySnapshotId,
                agentId,
                workspaceId: run.workspace_id,
                toolId,
                toolMatchTarget,
                url,
                inputProvenance: { source: "workflow", trusted: true },
              });
              // Observe-only mode records decisions but doesn't block execution.
              return this.policyService.isObserveOnly() ? "allow" : evaluation.decision;
            }

            if (snapshotState === "missing" || !policyBundle) {
              return "require_approval";
            }

            const toolsDomain = normalizeDomain(policyBundle.tools, "require_approval");
            const egressDomain = normalizeDomain(policyBundle.network_egress, "require_approval");

            // Tool policy is evaluated on the coarse-grained `tool_id` (e.g. `tool.exec`).
            // Fine-grained, argument-aware allow rules are handled via policy overrides
            // matched against the tool's normalized `toolMatchTarget`, which requires an
            // enabled PolicyService (evaluateToolCallFromSnapshot).
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
		               WHERE step_id = ? AND status = 'queued'`,
              [next.step_id],
            );

            if (updated.changes === 1) {
              const attemptAgg = await tx.get<{ n: number }>(
                "SELECT COALESCE(MAX(attempt), 0) AS n FROM execution_attempts WHERE step_id = ?",
                [next.step_id],
              );
              const attemptNum = (attemptAgg?.n ?? 0) + 1;
              const attemptId = randomUUID();

              await tx.run(
                `INSERT INTO execution_attempts (
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
		                 ) VALUES (?, ?, ?, 'failed', ?, ?, ?, NULL, ?, '[]', ?)`,
                [
                  attemptId,
                  next.step_id,
                  attemptNum,
                  clock.nowIso,
                  clock.nowIso,
                  policySnapshotId,
                  this.redactText(`policy denied ${toolId}`).trim() || "policy denied",
                  JSON.stringify(
                    this.redactUnknown({
                      policy_snapshot_id: policySnapshotId,
                      tool_id: toolId,
                      tool_match_target: toolMatchTarget,
                      url,
                      decision,
                    }),
                  ),
                ],
              );

              // Policy denies are terminal for the run: fail the run, cancel remaining queued
              // steps, and release lane/workspace leases so future ticks do not continue.
              await tx.run(
                `UPDATE execution_steps
	                 SET status = 'cancelled'
	                 WHERE run_id = ? AND status = 'queued'`,
                [run.run_id],
              );
              const runUpdated = await tx.run(
                `UPDATE execution_runs
	                 SET status = 'failed', finished_at = ?
	                 WHERE run_id = ? AND status != 'cancelled'`,
                [clock.nowIso, run.run_id],
              );
              await tx.run(
                `UPDATE execution_jobs
	                 SET status = 'failed'
	                 WHERE job_id = ? AND status != 'cancelled'`,
                [run.job_id],
              );
              if (runUpdated.changes === 1) {
                await this.emitRunUpdatedTx(tx, run.run_id);
              }
              await tx.run(
                `DELETE FROM lane_leases
	                 WHERE key = ? AND lane = ? AND lease_owner = ?`,
                [run.key, run.lane, input.workerId],
              );
              await tx.run(
                `DELETE FROM workspace_leases
	                 WHERE workspace_id = ? AND lease_owner = ?`,
                [run.workspace_id, input.workerId],
              );

              await this.emitStepUpdatedTx(tx, next.step_id);
              await this.emitAttemptUpdatedTx(tx, attemptId);
              return { kind: "recovered" as const };
            }

            // Fail closed: if we can't atomically transition the queued step to a terminal
            // state, do not proceed to execute the policy-denied action.
            return { kind: "noop" as const };
          }

          if (decision === "require_approval") {
            const approvalStatus = next.approval_id
              ? await tx.get<{ status: string }>(
                  "SELECT status FROM approvals WHERE id = ? LIMIT 1",
                  [next.approval_id],
                )
              : undefined;
            const alreadyApproved = approvalStatus?.status === "approved";

            if (!alreadyApproved) {
              const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
              const paused = await this.pauseRunForApproval(
                tx,
                {
                  planId,
                  stepIndex: next.step_index,
                  runId: run.run_id,
                  jobId: run.job_id,
                  stepId: next.step_id,
                  workspaceId: run.workspace_id,
                  key: run.key,
                  lane: run.lane,
                  workerId: input.workerId,
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
                kind: "paused" as const,
                reason: "policy" as const,
                approvalId: paused.approvalId,
              };
            }
          }
        }
      }

      const attemptAgg = await tx.get<{ n: number }>(
        "SELECT COALESCE(MAX(attempt), 0) AS n FROM execution_attempts WHERE step_id = ?",
        [next.step_id],
      );
      const attemptNum = (attemptAgg?.n ?? 0) + 1;
      const attemptId = randomUUID();

      const leaseTtlMs = Math.max(30_000, next.timeout_ms + 10_000);

      if (next.idempotency_key) {
        const record = await tx.get<{ status: string; result_json: string | null }>(
          `SELECT status, result_json
           FROM idempotency_records
           WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
          [next.step_id, next.idempotency_key],
        );

        if (record?.status === "succeeded") {
          const updated = await tx.run(
            `UPDATE execution_steps
             SET status = 'succeeded'
             WHERE step_id = ? AND status = 'queued'`,
            [next.step_id],
          );
          if (updated.changes === 1) {
            await tx.run(
              `INSERT INTO execution_attempts (
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
               ) VALUES (?, ?, ?, 'succeeded', ?, ?, ?, '[]', ?, NULL)`,
              [
                attemptId,
                next.step_id,
                attemptNum,
                clock.nowIso,
                clock.nowIso,
                run.policy_snapshot_id ?? null,
                record.result_json ?? null,
              ],
            );

            await this.emitStepUpdatedTx(tx, next.step_id);
            await this.emitAttemptUpdatedTx(tx, attemptId);
            return { kind: "idempotent" as const };
          }
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
      } catch {
        // ignore malformed action_json
      }

      const policy = this.policyService;
      if (
        policy &&
        policy.isEnabled() &&
        !policy.isObserveOnly() &&
        parsedAction &&
        (actionType === "CLI" || actionType === "Http")
      ) {
        const secretScopes = await this.resolveSecretScopesFromArgs(parsedAction.args ?? {});

        if (secretScopes.length > 0) {
          const secretsDecision = (
            await policy.evaluateSecretsFromSnapshot({
              policySnapshotId: run.policy_snapshot_id,
              secretScopes,
            })
          ).decision;

          if (secretsDecision === "deny") {
            const stepFailed = await tx.run(
              `UPDATE execution_steps
               SET status = 'failed'
               WHERE step_id = ? AND status = 'queued'`,
              [next.step_id],
            );

            if (stepFailed.changes !== 1) {
              return { kind: "noop" as const };
            }

            await tx.run(
              `INSERT INTO execution_attempts (
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
               ) VALUES (?, ?, ?, 'failed', ?, ?, ?, '[]', NULL, ?)`,
              [
                attemptId,
                next.step_id,
                attemptNum,
                clock.nowIso,
                clock.nowIso,
                run.policy_snapshot_id ?? null,
                this.redactText(
                  `policy denied secret resolution for scopes: ${secretScopes.join(", ")}`,
                ),
              ],
            );

            await tx.run(
              `UPDATE execution_steps
               SET status = 'cancelled'
               WHERE run_id = ?
                 AND step_id != ?
                 AND status IN ('queued', 'paused', 'running')`,
              [run.run_id, next.step_id],
            );

            await tx.run(
              `UPDATE execution_runs
               SET status = 'failed', finished_at = ?
               WHERE run_id = ? AND status IN ('running', 'queued')`,
              [clock.nowIso, run.run_id],
            );

            await tx.run(
              `UPDATE execution_jobs
               SET status = 'failed'
               WHERE job_id = ? AND status IN ('queued', 'running')`,
              [run.job_id],
            );

            await tx.run(
              `DELETE FROM lane_leases
               WHERE key = ? AND lane = ? AND lease_owner = ?`,
              [run.key, run.lane, input.workerId],
            );

            await tx.run(
              `DELETE FROM workspace_leases
               WHERE workspace_id = ? AND lease_owner = ?`,
              [run.workspace_id, input.workerId],
            );

            await this.emitAttemptUpdatedTx(tx, attemptId);
            await this.emitRunUpdatedTx(tx, run.run_id);

            const stepIds = await tx.all<{ step_id: string }>(
              "SELECT step_id FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
              [run.run_id],
            );
            for (const row of stepIds) {
              await this.emitStepUpdatedTx(tx, row.step_id);
            }

            return { kind: "finalized" as const };
          }

          if (secretsDecision === "require_approval") {
            const alreadyApproved = await this.isApprovedPolicyGateTx(tx, next.approval_id);
            if (!alreadyApproved) {
              const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
              const paused = await this.pauseRunForApproval(
                tx,
                {
                  planId,
                  stepIndex: next.step_index,
                  runId: run.run_id,
                  jobId: run.job_id,
                  stepId: next.step_id,
                  workspaceId: run.workspace_id,
                  key: run.key,
                  lane: run.lane,
                  workerId: input.workerId,
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
                kind: "paused" as const,
                reason: "policy" as const,
                approvalId: paused.approvalId,
              };
            }
          }
        }
      }

      const agentId = this.deriveAgentIdFromKey(run.key) ?? "default";
      const capability = actionType ? requiredCapability(actionType) : undefined;

      const concurrencyOk = await this.tryAcquireConcurrencyForAttemptTx(tx, {
        attemptId,
        owner: input.workerId,
        nowMs: clock.nowMs,
        nowIso: clock.nowIso,
        ttlMs: leaseTtlMs,
        agentId,
        capability,
      });
      if (!concurrencyOk) {
        // Avoid blocking other workspaces while we're capacity-limited.
        await tx.run(
          `DELETE FROM workspace_leases
           WHERE workspace_id = ? AND lease_owner = ?`,
          [run.workspace_id, input.workerId],
        );
        return { kind: "noop" as const };
      }

      const updated = await tx.run(
        `UPDATE execution_steps
         SET status = 'running'
         WHERE step_id = ? AND status = 'queued'`,
        [next.step_id],
      );

      if (updated.changes !== 1) {
        await this.releaseConcurrencySlotsTx(tx, attemptId, clock.nowIso);
        return { kind: "noop" as const };
      }

      await tx.run(
        `INSERT INTO execution_attempts (
           attempt_id,
           step_id,
           attempt,
           status,
           started_at,
           policy_snapshot_id,
           artifacts_json,
           lease_owner,
           lease_expires_at_ms
         ) VALUES (?, ?, ?, 'running', ?, ?, '[]', ?, ?)`,
        [
          attemptId,
          next.step_id,
          attemptNum,
          clock.nowIso,
          run.policy_snapshot_id ?? null,
          input.workerId,
          clock.nowMs + leaseTtlMs,
        ],
      );

      await tx.run(
        `UPDATE lane_leases
         SET lease_expires_at_ms = ?
         WHERE key = ? AND lane = ? AND lease_owner = ?`,
        [clock.nowMs + leaseTtlMs, run.key, run.lane, input.workerId],
      );

      await tx.run(
        `UPDATE workspace_leases
         SET lease_expires_at_ms = ?
         WHERE workspace_id = ? AND lease_owner = ?`,
        [clock.nowMs + leaseTtlMs, run.workspace_id, input.workerId],
      );

      await this.emitStepUpdatedTx(tx, next.step_id);
      await this.emitAttemptUpdatedTx(tx, attemptId);
      return {
        kind: "claimed" as const,
        runId: run.run_id,
        jobId: run.job_id,
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

    if (outcome.kind === "noop") return false;
    if (outcome.kind === "recovered") return true;
    if (outcome.kind === "finalized") return true;
    if (outcome.kind === "idempotent") return true;
    if (outcome.kind === "cancelled") return true;
    if (outcome.kind === "paused") return true;

    const planId = parsePlanIdFromTriggerJson(outcome.triggerJson) ?? outcome.runId;

    const action = JSON.parse(outcome.step.action_json) as ActionPrimitiveT;
    const timeoutMs = Math.max(1, outcome.step.timeout_ms);

    return await this.executeAttempt({
      planId,
      stepIndex: outcome.step.step_index,
      action,
      postconditionJson: outcome.step.postcondition_json,
      maxAttempts: outcome.step.max_attempts,
      timeoutMs,
      runId: outcome.runId,
      jobId: outcome.jobId,
      workspaceId: run.workspace_id,
      key: outcome.key,
      lane: outcome.lane,
      stepId: outcome.step.step_id,
      attemptId: outcome.attempt.attemptId,
      attemptNum: outcome.attempt.attemptNum,
      workerId: input.workerId,
      executor: input.executor,
    });
  }

  private async executeAttempt(opts: {
    planId: string;
    stepIndex: number;
    action: ActionPrimitiveT;
    postconditionJson: string | null;
    maxAttempts: number;
    timeoutMs: number;
    runId: string;
    jobId: string;
    workspaceId: string;
    key: string;
    lane: string;
    stepId: string;
    attemptId: string;
    attemptNum: number;
    workerId: string;
    executor: StepExecutor;
  }): Promise<boolean> {
    const wallStartMs = Date.now();

    this.logger?.info("execution.attempt.start", {
      plan_id: opts.planId,
      job_id: opts.jobId,
      run_id: opts.runId,
      step_id: opts.stepId,
      attempt_id: opts.attemptId,
      attempt: opts.attemptNum,
      key: opts.key,
      lane: opts.lane,
      worker_id: opts.workerId,
      step_index: opts.stepIndex,
      action_type: opts.action.type,
    });

    await this.persistAttemptPolicyContext(opts).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("execution.attempt.policy_persist_failed", {
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        error: message,
      });
    });

    const approvalRow = await this.db.get<{ approval_id: number | null }>(
      "SELECT approval_id FROM execution_steps WHERE step_id = ?",
      [opts.stepId],
    );
    const runPolicy = await this.db.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE run_id = ?",
      [opts.runId],
    );

    const result = await this.executeWithTimeout(
      opts.executor,
      opts.action,
      opts.planId,
      opts.stepIndex,
      opts.timeoutMs,
      {
        runId: opts.runId,
        stepId: opts.stepId,
        attemptId: opts.attemptId,
        approvalId: approvalRow?.approval_id ?? null,
        key: opts.key,
        lane: opts.lane,
        workspaceId: opts.workspaceId,
        policySnapshotId: runPolicy?.policy_snapshot_id ?? null,
      },
    );
    const wallDurationMs = Math.max(0, Date.now() - wallStartMs);

    const evidenceJson =
      result.evidence !== undefined ? JSON.stringify(this.redactUnknown(result.evidence)) : null;
    const artifactsJson = JSON.stringify(this.redactUnknown(result.artifacts ?? []));
    const cost = this.redactUnknown(
      result.cost
        ? { ...result.cost, duration_ms: result.cost.duration_ms ?? wallDurationMs }
        : { duration_ms: wallDurationMs },
    );
    const costJson = JSON.stringify(cost);

    const nowIso = this.clock().nowIso;

    // Postcondition evaluation is based on executor output, not DB state.
    let postconditionError: string | undefined;
    let postconditionReportJson: string | null = null;
    let pauseDetail: string | undefined;

    if (result.success && opts.postconditionJson) {
      try {
        const spec = JSON.parse(opts.postconditionJson) as unknown;
        const report = evaluatePostcondition(spec, result.evidence ?? {});
        postconditionReportJson = JSON.stringify(this.redactUnknown(report));
        if (!report.passed) {
          postconditionError = "postcondition failed";
        }
      } catch (err) {
        if (err instanceof PostconditionError && err.kind === "missing_evidence") {
          pauseDetail = `postcondition missing evidence: ${err.message}`;
        } else if (err instanceof PostconditionError) {
          postconditionError = `postcondition error: ${err.message}`;
        } else {
          postconditionError = "postcondition error";
        }
      }
    }

    const outcome = await this.db.transaction(async (tx) => {
      const current = await tx.get<{ run_status: string; job_status: string }>(
        `SELECT r.status AS run_status, j.status AS job_status
         FROM execution_runs r
         JOIN execution_jobs j ON j.job_id = r.job_id
         WHERE r.run_id = ?`,
        [opts.runId],
      );
      const step = await tx.get<{ status: string }>(
        "SELECT status FROM execution_steps WHERE step_id = ?",
        [opts.stepId],
      );

      const cancelled =
        current?.run_status === "cancelled" ||
        current?.job_status === "cancelled" ||
        step?.status === "cancelled";

      if (cancelled) {
        await tx.run(
          `UPDATE execution_attempts
           SET status = 'cancelled',
               finished_at = COALESCE(finished_at, ?),
               error = COALESCE(error, 'cancelled'),
               metadata_json = COALESCE(metadata_json, ?),
               artifacts_json = COALESCE(artifacts_json, ?),
               cost_json = COALESCE(cost_json, ?)
           WHERE attempt_id = ? AND status = 'running'`,
          [nowIso, evidenceJson, artifactsJson, costJson, opts.attemptId],
        );
        await this.emitAttemptUpdatedTx(tx, opts.attemptId);
        await this.releaseConcurrencySlotsTx(tx, opts.attemptId, nowIso);
        await tx.run(
          `DELETE FROM lane_leases
           WHERE key = ? AND lane = ? AND lease_owner = ?`,
          [opts.key, opts.lane, opts.workerId],
        );
        await tx.run(
          `DELETE FROM workspace_leases
           WHERE workspace_id = ? AND lease_owner = ?`,
          [opts.workspaceId, opts.workerId],
        );
        return { kind: "cancelled" as const };
      }

      if (result.success) {
        if (result.pause) {
          await this.markAttemptSucceeded(
            tx,
            opts,
            result,
            evidenceJson,
            postconditionReportJson,
            artifactsJson,
            costJson,
          );
          const artifacts = safeJsonParse(artifactsJson, [] as ArtifactRefT[]);
          await this.recordArtifactsTx(
            tx,
            {
              runId: opts.runId,
              stepId: opts.stepId,
              attemptId: opts.attemptId,
              workspaceId: opts.workspaceId,
              key: opts.key,
            },
            artifacts,
          );
          const paused = await this.pauseRunForApproval(tx, opts, {
            kind: result.pause.kind,
            prompt: result.pause.prompt,
            detail: result.pause.detail,
            context: result.pause.context,
            expiresAt: result.pause.expiresAt ?? undefined,
          });
          return {
            kind: "paused" as const,
            reason: "approval" as const,
            approvalId: paused.approvalId,
          };
        }

        if (pauseDetail) {
          await this.markAttemptSucceeded(
            tx,
            opts,
            result,
            evidenceJson,
            null,
            artifactsJson,
            costJson,
          );
          const artifacts = safeJsonParse(artifactsJson, [] as ArtifactRefT[]);
          await this.recordArtifactsTx(
            tx,
            {
              runId: opts.runId,
              stepId: opts.stepId,
              attemptId: opts.attemptId,
              workspaceId: opts.workspaceId,
              key: opts.key,
            },
            artifacts,
          );
          const paused = await this.pauseRunForApproval(tx, opts, {
            kind: "takeover",
            prompt: "Takeover required to continue workflow",
            detail: pauseDetail,
            context: {
              source: "execution-engine",
              run_id: opts.runId,
              job_id: opts.jobId,
              step_id: opts.stepId,
              attempt_id: opts.attemptId,
              action: opts.action,
            },
          });
          return {
            kind: "paused" as const,
            reason: "takeover" as const,
            approvalId: paused.approvalId,
          };
        }

        if (postconditionError) {
          await this.markAttemptFailed(
            tx,
            opts,
            postconditionError,
            evidenceJson,
            postconditionReportJson,
            artifactsJson,
            costJson,
          );
          const artifacts = safeJsonParse(artifactsJson, [] as ArtifactRefT[]);
          await this.recordArtifactsTx(
            tx,
            {
              runId: opts.runId,
              stepId: opts.stepId,
              attemptId: opts.attemptId,
              workspaceId: opts.workspaceId,
              key: opts.key,
            },
            artifacts,
          );
          await this.maybeRetryOrFailStep({
            tx,
            nowIso,
            attemptNum: opts.attemptNum,
            maxAttempts: opts.maxAttempts,
            stepId: opts.stepId,
            attemptId: opts.attemptId,
            runId: opts.runId,
            jobId: opts.jobId,
            workspaceId: opts.workspaceId,
            key: opts.key,
            lane: opts.lane,
            workerId: opts.workerId,
          });
          return { kind: "failed" as const, status: "failed" as const, error: postconditionError };
        }

        await this.markAttemptSucceeded(
          tx,
          opts,
          result,
          evidenceJson,
          postconditionReportJson,
          artifactsJson,
          costJson,
        );
        const artifacts = safeJsonParse(artifactsJson, [] as ArtifactRefT[]);
        await this.recordArtifactsTx(
          tx,
          {
            runId: opts.runId,
            stepId: opts.stepId,
            attemptId: opts.attemptId,
            workspaceId: opts.workspaceId,
            key: opts.key,
          },
          artifacts,
        );

        const stepUpdated = await tx.run(
          `UPDATE execution_steps
           SET status = 'succeeded'
           WHERE step_id = ? AND status = 'running'`,
          [opts.stepId],
        );
        if (stepUpdated.changes === 1) {
          await this.emitStepUpdatedTx(tx, opts.stepId);
        }

        const idempotencyKey = opts.action.idempotency_key?.trim();
        if (idempotencyKey) {
          const resultJson =
            result.result !== undefined ? JSON.stringify(this.redactUnknown(result.result)) : null;
          await tx.run(
            `INSERT INTO idempotency_records (
               scope_key,
               kind,
               idempotency_key,
               status,
               result_json,
               error,
               updated_at
             ) VALUES (?, 'step', ?, 'succeeded', ?, NULL, ?)
             ON CONFLICT (scope_key, kind, idempotency_key) DO UPDATE SET
               status = excluded.status,
               result_json = excluded.result_json,
               error = NULL,
               updated_at = excluded.updated_at`,
            [opts.stepId, idempotencyKey, resultJson, nowIso],
          );
        }

        return { kind: "succeeded" as const };
      }

      const error = result.error ?? "unknown error";
      const redactedError = this.redactText(error);
      const timedOut = error.toLowerCase().includes("timed out");
      const status = timedOut ? "timed_out" : "failed";

      await tx.run(
        `UPDATE execution_attempts
         SET status = ?,
             finished_at = ?,
             result_json = NULL,
             error = ?,
             metadata_json = ?,
             artifacts_json = ?,
             cost_json = ?
         WHERE attempt_id = ? AND status = 'running'`,
        [status, nowIso, redactedError, evidenceJson, artifactsJson, costJson, opts.attemptId],
      );
      await this.emitAttemptUpdatedTx(tx, opts.attemptId);
      const artifacts = safeJsonParse(artifactsJson, [] as ArtifactRefT[]);
      await this.recordArtifactsTx(
        tx,
        {
          runId: opts.runId,
          stepId: opts.stepId,
          attemptId: opts.attemptId,
          workspaceId: opts.workspaceId,
          key: opts.key,
        },
        artifacts,
      );
      await this.releaseConcurrencySlotsTx(tx, opts.attemptId, nowIso);

      await this.maybeRetryOrFailStep({
        tx,
        nowIso,
        attemptNum: opts.attemptNum,
        maxAttempts: opts.maxAttempts,
        stepId: opts.stepId,
        attemptId: opts.attemptId,
        runId: opts.runId,
        jobId: opts.jobId,
        workspaceId: opts.workspaceId,
        key: opts.key,
        lane: opts.lane,
        workerId: opts.workerId,
      });
      return { kind: "failed" as const, status, error: redactedError };
    });

    if (outcome.kind === "paused") {
      this.logger?.info("execution.attempt.paused", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        reason: outcome.reason,
        approval_id: outcome.approvalId,
      });
      return true;
    }

    if (outcome.kind === "succeeded") {
      this.logger?.info("execution.attempt.succeeded", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        status: "succeeded",
        duration_ms: wallDurationMs,
        cost,
      });
      return true;
    }

    if (outcome.kind === "cancelled") {
      this.logger?.info("execution.attempt.cancelled", {
        job_id: opts.jobId,
        run_id: opts.runId,
        step_id: opts.stepId,
        attempt_id: opts.attemptId,
        status: "cancelled",
      });
      return true;
    }

    this.logger?.info("execution.attempt.failed", {
      job_id: opts.jobId,
      run_id: opts.runId,
      step_id: opts.stepId,
      attempt_id: opts.attemptId,
      status: outcome.status,
      error: outcome.error,
      duration_ms: wallDurationMs,
      cost,
    });

    return true;
  }

  private async persistAttemptPolicyContext(opts: {
    runId: string;
    stepId: string;
    attemptId: string;
    key: string;
    workspaceId: string;
    action: ActionPrimitiveT;
  }): Promise<void> {
    const run = await this.db.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM execution_runs WHERE run_id = ?",
      [opts.runId],
    );
    const policySnapshotId = run?.policy_snapshot_id?.trim() ?? "";
    if (!policySnapshotId) return;

    const tool = this.toolCallFromAction(opts.action);
    await this.db.run(
      `UPDATE execution_attempts
	       SET policy_snapshot_id = ?
	       WHERE attempt_id = ?`,
      [policySnapshotId, opts.attemptId],
    );

    if (!this.policyService?.isEnabled()) return;

    const agentId = this.deriveAgentIdFromKey(opts.key) ?? "default";
    const secretScopes = await this.resolveSecretScopesFromArgs(opts.action.args ?? {});
    const evaluation = await this.policyService.evaluateToolCallFromSnapshot({
      policySnapshotId,
      agentId,
      workspaceId: opts.workspaceId,
      toolId: tool.toolId,
      toolMatchTarget: tool.matchTarget,
      url: tool.url,
      secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
      inputProvenance: { source: "workflow", trusted: true },
    });

    const decisionJson = JSON.stringify(
      evaluation.decision_record ?? { decision: evaluation.decision, rules: [] },
    );
    const appliedOverrideIdsJson = JSON.stringify(evaluation.applied_override_ids ?? []);

    await this.db.run(
      `UPDATE execution_attempts
       SET policy_decision_json = ?,
           policy_applied_override_ids_json = ?
       WHERE attempt_id = ?`,
      [decisionJson, appliedOverrideIdsJson, opts.attemptId],
    );
  }

  private toolCallFromAction(action: ActionPrimitiveT): {
    toolId: string;
    matchTarget: string;
    url?: string;
  } {
    const args = action.args as unknown;
    const rec: Record<string, unknown> =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};

    if (action.type === "CLI") {
      const cmd = typeof rec["cmd"] === "string" ? rec["cmd"].trim() : "";
      const argv = Array.isArray(rec["args"])
        ? (rec["args"] as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const command = [cmd, ...argv]
        .filter((t) => t.trim().length > 0)
        .join(" ")
        .trim();
      const matchTarget = canonicalizeToolMatchTarget("tool.exec", { command });
      return { toolId: "tool.exec", matchTarget };
    }

    if (action.type === "Http") {
      const url = typeof rec["url"] === "string" ? rec["url"].trim() : "";
      const matchTarget = canonicalizeToolMatchTarget("tool.http.fetch", { url });
      return { toolId: "tool.http.fetch", matchTarget, url: url.length > 0 ? url : undefined };
    }

    const toolId = `action.${action.type}`;
    const matchTarget = canonicalizeToolMatchTarget(toolId, rec);
    return { toolId, matchTarget };
  }

  private async markAttemptSucceeded(
    tx: SqlDb,
    opts: { attemptId: string },
    result: StepResult,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const resultJson =
      result.result !== undefined ? JSON.stringify(this.redactUnknown(result.result)) : null;

    const nowIso = this.clock().nowIso;
    await tx.run(
      `UPDATE execution_attempts
       SET status = 'succeeded',
           finished_at = ?,
           result_json = ?,
           error = NULL,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE attempt_id = ? AND status = 'running'`,
      [
        nowIso,
        resultJson,
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      ],
    );
    await this.emitAttemptUpdatedTx(tx, opts.attemptId);
    await this.releaseConcurrencySlotsTx(tx, opts.attemptId, nowIso);
  }

  private async markAttemptFailed(
    tx: SqlDb,
    opts: { attemptId: string },
    error: string,
    evidenceJson: string | null,
    postconditionReportJson: string | null,
    artifactsJson: string,
    costJson: string,
  ): Promise<void> {
    const nowIso = this.clock().nowIso;
    await tx.run(
      `UPDATE execution_attempts
       SET status = 'failed',
           finished_at = ?,
           result_json = NULL,
           error = ?,
           postcondition_report_json = ?,
           metadata_json = ?,
           artifacts_json = ?,
           cost_json = ?
       WHERE attempt_id = ? AND status = 'running'`,
      [
        nowIso,
        this.redactText(error),
        postconditionReportJson,
        evidenceJson,
        artifactsJson,
        costJson,
        opts.attemptId,
      ],
    );
    await this.emitAttemptUpdatedTx(tx, opts.attemptId);
    await this.releaseConcurrencySlotsTx(tx, opts.attemptId, nowIso);
  }

  private async maybeRetryOrFailStep(
    opts: {
      tx: SqlDb;
      nowIso: string;
    } & {
      attemptNum: number;
      maxAttempts: number;
      stepId: string;
      attemptId?: string;
      runId: string;
      jobId: string;
      workspaceId: string;
      key: string;
      lane: string;
      workerId: string;
    },
  ): Promise<boolean> {
    const tx = opts.tx;
    const maxAttempts = Math.max(1, opts.maxAttempts);
    if (opts.attemptNum < maxAttempts) {
      const step = await tx.get<{
        idempotency_key: string | null;
        action_json: string;
        step_index: number;
      }>(
        `SELECT idempotency_key, action_json, step_index
         FROM execution_steps
         WHERE step_id = ?`,
        [opts.stepId],
      );

      const idempotencyKey = step?.idempotency_key?.trim() ?? "";
      let actionType: ActionPrimitiveT["type"] | undefined;
      try {
        const parsed = JSON.parse(step?.action_json ?? "{}") as { type?: unknown };
        if (typeof parsed?.type === "string") {
          actionType = parsed.type as ActionPrimitiveT["type"];
        }
      } catch {
        // ignore
      }

      const isStateChanging = actionType ? requiresPostcondition(actionType) : true;
      const autoRetryAllowed = idempotencyKey.length > 0 || !isStateChanging;

      if (autoRetryAllowed) {
        await tx.run(
          `UPDATE execution_steps
           SET status = 'queued'
           WHERE step_id = ? AND status = 'running'`,
          [opts.stepId],
        );
        await this.emitStepUpdatedTx(tx, opts.stepId);
        return true;
      }

      const job = await tx.get<{ trigger_json: string }>(
        "SELECT trigger_json FROM execution_jobs WHERE job_id = ?",
        [opts.jobId],
      );
      const planId =
        (job?.trigger_json ? parsePlanIdFromTriggerJson(job.trigger_json) : undefined) ??
        opts.runId;

      await this.pauseRunForApproval(
        tx,
        {
          planId,
          stepIndex: step?.step_index ?? 0,
          runId: opts.runId,
          jobId: opts.jobId,
          stepId: opts.stepId,
          attemptId: opts.attemptId,
          workspaceId: opts.workspaceId,
          key: opts.key,
          lane: opts.lane,
          workerId: opts.workerId,
        },
        {
          kind: "retry",
          prompt: "Retry required — step is not idempotent",
          detail:
            "Step failed and is state-changing without an idempotency_key; automatic retries are disabled. Approve to retry.",
          context: {
            action_type: actionType,
            attempt: opts.attemptNum,
            max_attempts: maxAttempts,
          },
        },
      );

      return true;
    }

    await tx.run(
      `UPDATE execution_steps
       SET status = 'failed'
       WHERE step_id = ? AND status = 'running'`,
      [opts.stepId],
    );
    await this.emitStepUpdatedTx(tx, opts.stepId);

    await tx.run(
      `UPDATE execution_steps
       SET status = 'cancelled'
       WHERE run_id = ? AND status = 'queued'`,
      [opts.runId],
    );

    const runUpdated = await tx.run(
      `UPDATE execution_runs
       SET status = 'failed', finished_at = ?
       WHERE run_id = ? AND status != 'cancelled'`,
      [opts.nowIso, opts.runId],
    );

    await tx.run(
      `UPDATE execution_jobs
       SET status = 'failed'
       WHERE job_id = ? AND status != 'cancelled'`,
      [opts.jobId],
    );

    if (runUpdated.changes === 1) {
      await this.emitRunUpdatedTx(tx, opts.runId);
    }

    await tx.run(
      `DELETE FROM lane_leases
       WHERE key = ? AND lane = ? AND lease_owner = ?`,
      [opts.key, opts.lane, opts.workerId],
    );
    await tx.run(
      `DELETE FROM workspace_leases
       WHERE workspace_id = ? AND lease_owner = ?`,
      [opts.workspaceId, opts.workerId],
    );

    return true;
  }

  private async pauseRunForApproval(
    tx: SqlDb,
    opts: {
      planId: string;
      stepIndex: number;
      runId: string;
      stepId: string;
      attemptId?: string;
      jobId: string;
      workspaceId: string;
      key: string;
      lane: string;
      workerId: string;
    },
    input: {
      kind: string;
      prompt: string;
      detail: string;
      context?: unknown;
      expiresAt?: string | null;
    },
  ): Promise<{ approvalId: number; resumeToken: string }> {
    const nowIso = this.clock().nowIso;
    const expiresAt =
      input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const pausedReason =
      input.kind === "takeover"
        ? "takeover"
        : input.kind === "budget"
          ? "budget"
          : input.kind === "policy"
            ? "policy"
            : "approval";
    const pausedDetail = this.redactText(input.detail);

    const runUpdated = await tx.run(
      `UPDATE execution_runs
       SET status = 'paused', paused_reason = ?, paused_detail = ?
       WHERE run_id = ? AND status IN ('running', 'queued')`,
      [pausedReason, pausedDetail, opts.runId],
    );
    if (runUpdated.changes !== 1) {
      throw new Error(`failed to pause run ${opts.runId}`);
    }

    const resumeToken = `resume-${randomUUID()}`;
    await tx.run(
      `INSERT INTO resume_tokens (token, run_id, created_at)
       VALUES (?, ?, ?)`,
      [resumeToken, opts.runId, nowIso],
    );

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value);

    const baseContext: Record<string, unknown> = {
      ...(isRecord(input.context) ? input.context : {}),
      resume_token: resumeToken,
      run_id: opts.runId,
      job_id: opts.jobId,
      step_id: opts.stepId,
      ...(opts.attemptId ? { attempt_id: opts.attemptId } : {}),
      paused_reason: pausedReason,
      paused_detail: input.detail,
    };
    const contextToPersist = this.redactUnknown(baseContext);

    const agentId =
      opts.key.startsWith("agent:") && opts.key.split(":").length > 1
        ? opts.key.split(":")[1]!
        : "default";

    const approval = await tx.get<{
      id: number;
      kind: string;
      status: string;
      prompt: string;
      context_json: string;
      created_at: string | Date;
      expires_at: string | Date | null;
    }>(
      `INSERT INTO approvals (
         plan_id,
         step_index,
         prompt,
         context_json,
         expires_at,
         kind,
         agent_id,
         workspace_id,
         key,
         lane,
         run_id,
         resume_token
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, kind, status, prompt, context_json, created_at, expires_at`,
      [
        opts.planId,
        opts.stepIndex,
        input.prompt,
        JSON.stringify(contextToPersist),
        expiresAt,
        input.kind,
        agentId,
        opts.workspaceId,
        opts.key,
        opts.lane,
        opts.runId,
        resumeToken,
      ],
    );
    if (!approval) {
      throw new Error("approval insert failed");
    }

    const stepUpdated = await tx.run(
      `UPDATE execution_steps
       SET status = 'paused', approval_id = ?
       WHERE step_id = ? AND status IN ('running', 'queued')`,
      [approval.id, opts.stepId],
    );
    if (stepUpdated.changes !== 1) {
      throw new Error(`failed to pause step ${opts.stepId}`);
    }

    // Release leases while paused.
    await tx.run(
      `DELETE FROM lane_leases
       WHERE key = ? AND lane = ? AND lease_owner = ?`,
      [opts.key, opts.lane, opts.workerId],
    );
    await tx.run(
      `DELETE FROM workspace_leases
       WHERE workspace_id = ? AND lease_owner = ?`,
      [opts.workspaceId, opts.workerId],
    );

    // Emit run/step state updates and approval events/requests.
    await this.emitRunUpdatedTx(tx, opts.runId);
    await this.emitStepUpdatedTx(tx, opts.stepId);

    await this.emitRunPausedTx(tx, {
      runId: opts.runId,
      reason: pausedReason,
      approvalId: approval.id,
      detail: pausedDetail,
    });

    const approvalContext = safeJsonParse(approval.context_json, {}) as unknown;
    const approvalRequestedEvt: WsEventEnvelopeT = {
      event_id: randomUUID(),
      type: "approval.requested",
      occurred_at: nowIso,
      scope: { kind: "run", run_id: opts.runId },
      payload: {
        approval: {
          approval_id: approval.id,
          kind: approval.kind,
          status: "pending",
          prompt: approval.prompt,
          context: approvalContext,
          scope: {
            agent_id: agentId,
            ...(TyrumKey.safeParse(opts.key).success ? { key: opts.key } : {}),
            ...(Lane.safeParse(opts.lane).success ? { lane: opts.lane } : {}),
            run_id: opts.runId,
            step_index: opts.stepIndex,
          },
          created_at: normalizeDbDateTime(approval.created_at) ?? nowIso,
          expires_at: normalizeDbDateTime(approval.expires_at),
          resolution: null,
        },
      },
    };
    await this.enqueueWsEvent(tx, approvalRequestedEvt);

    const approvalRequest: WsRequestEnvelopeT = {
      request_id: `approval-${String(approval.id)}`,
      type: "approval.request",
      payload: {
        approval_id: approval.id,
        plan_id: opts.planId,
        step_index: opts.stepIndex,
        prompt: input.prompt,
        context: approvalContext,
        expires_at: normalizeDbDateTime(approval.expires_at),
      },
    };
    await this.enqueueWsMessage(tx, approvalRequest);

    return { approvalId: approval.id, resumeToken };
  }

  private async executeWithTimeout(
    executor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    try {
      return await executor.execute(action, planId, stepIndex, timeoutMs, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  private async releaseConcurrencySlotsTx(
    tx: SqlDb,
    attemptId: string,
    nowIso: string,
  ): Promise<void> {
    if (!attemptId) return;
    if (!this.concurrencyLimits) return;
    await tx.run(
      `UPDATE concurrency_slots
       SET lease_owner = NULL,
           lease_expires_at_ms = NULL,
           attempt_id = NULL,
           updated_at = ?
       WHERE attempt_id = ?`,
      [nowIso, attemptId],
    );
  }

  private async ensureConcurrencySlotsTx(
    tx: SqlDb,
    scope: string,
    scopeId: string,
    limit: number,
  ): Promise<void> {
    for (let slot = 0; slot < limit; slot += 1) {
      await tx.run(
        `INSERT INTO concurrency_slots (scope, scope_id, slot)
         VALUES (?, ?, ?)
         ON CONFLICT (scope, scope_id, slot) DO NOTHING`,
        [scope, scopeId, slot],
      );
    }
  }

  private async tryAcquireConcurrencySlotTx(
    tx: SqlDb,
    opts: {
      scope: string;
      scopeId: string;
      limit: number;
      attemptId: string;
      owner: string;
      nowMs: number;
      nowIso: string;
      ttlMs: number;
    },
  ): Promise<boolean> {
    if (opts.limit <= 0) return false;

    await this.ensureConcurrencySlotsTx(tx, opts.scope, opts.scopeId, opts.limit);

    const expiresAtMs = opts.nowMs + Math.max(1, opts.ttlMs);
    const maxTries = Math.min(10, Math.max(1, opts.limit));

    for (let i = 0; i < maxTries; i += 1) {
      const updated = await tx.run(
        `UPDATE concurrency_slots
         SET lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt_id = ?,
             updated_at = ?
         WHERE scope = ? AND scope_id = ?
           AND slot IN (
             SELECT slot
             FROM concurrency_slots
             WHERE scope = ? AND scope_id = ?
               AND slot < ?
               AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
             ORDER BY COALESCE(lease_expires_at_ms, 0) ASC, slot ASC
             LIMIT 1
           )
           AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`,
        [
          opts.owner,
          expiresAtMs,
          opts.attemptId,
          opts.nowIso,
          opts.scope,
          opts.scopeId,
          opts.scope,
          opts.scopeId,
          opts.limit,
          opts.nowMs,
          opts.nowMs,
        ],
      );
      if (updated.changes === 1) {
        return true;
      }
    }

    return false;
  }

  private async tryAcquireConcurrencyForAttemptTx(
    tx: SqlDb,
    opts: {
      attemptId: string;
      owner: string;
      nowMs: number;
      nowIso: string;
      ttlMs: number;
      agentId: string;
      capability?: ClientCapabilityT;
    },
  ): Promise<boolean> {
    const limits = this.concurrencyLimits;
    if (!limits) return true;

    const globalLimit = limits.global;
    const perAgentLimit = limits.perAgent;
    const capabilityLimit =
      opts.capability && limits.perCapability ? limits.perCapability[opts.capability] : undefined;

    if (globalLimit === undefined && perAgentLimit === undefined && capabilityLimit === undefined) {
      return true;
    }

    const claimScope = async (
      scope: string,
      scopeId: string,
      limit: number | undefined,
    ): Promise<boolean> => {
      if (limit === undefined) return true;
      return await this.tryAcquireConcurrencySlotTx(tx, {
        scope,
        scopeId,
        limit,
        attemptId: opts.attemptId,
        owner: opts.owner,
        nowMs: opts.nowMs,
        nowIso: opts.nowIso,
        ttlMs: opts.ttlMs,
      });
    };

    if (!(await claimScope("global", "global", globalLimit))) {
      await this.releaseConcurrencySlotsTx(tx, opts.attemptId, opts.nowIso);
      return false;
    }

    if (!(await claimScope("agent", opts.agentId, perAgentLimit))) {
      await this.releaseConcurrencySlotsTx(tx, opts.attemptId, opts.nowIso);
      return false;
    }

    if (opts.capability && capabilityLimit !== undefined) {
      if (!(await claimScope("capability", opts.capability, capabilityLimit))) {
        await this.releaseConcurrencySlotsTx(tx, opts.attemptId, opts.nowIso);
        return false;
      }
    }

    return true;
  }

  private async tryAcquireLaneLease(opts: {
    key: string;
    lane: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<boolean> {
    const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
    return await this.db.transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (key, lane) DO NOTHING`,
        [opts.key, opts.lane, opts.owner, expiresAt],
      );
      if (inserted.changes === 1) return true;

      const updated = await tx.run(
        `UPDATE lane_leases
         SET lease_owner = ?, lease_expires_at_ms = ?
         WHERE key = ? AND lane = ?
           AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
        [opts.owner, expiresAt, opts.key, opts.lane, opts.nowMs, opts.owner],
      );
      return updated.changes === 1;
    });
  }

  private async tryAcquireWorkspaceLease(opts: {
    workspaceId: string;
    owner: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<boolean> {
    const expiresAt = opts.nowMs + Math.max(1, opts.ttlMs);
    return await this.db.transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO workspace_leases (workspace_id, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [opts.workspaceId, opts.owner, expiresAt],
      );
      if (inserted.changes === 1) return true;

      const updated = await tx.run(
        `UPDATE workspace_leases
         SET lease_owner = ?, lease_expires_at_ms = ?
         WHERE workspace_id = ?
           AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
        [opts.owner, expiresAt, opts.workspaceId, opts.nowMs, opts.owner],
      );
      return updated.changes === 1;
    });
  }
}
