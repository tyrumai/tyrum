import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
  Decision as DecisionT,
  ExecutionTrigger as ExecutionTriggerT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import {
  parseTyrumKey,
  PolicyBundle,
  requiredCapability,
  requiresPostcondition,
} from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { RedactionEngine } from "../../redaction/engine.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import type { SecretProvider } from "../../secret/provider.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../../policy/domain.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import type { SqlDb } from "../../../statestore/types.js";
import { normalizeDbDateTime } from "../../../utils/db-time.js";
import { safeJsonParse } from "../../../utils/json.js";
import { IdentityScopeDal } from "../../identity/scope.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { sha256HexFromString, stableJsonStringify } from "../../policy/canonical-json.js";
import { ExecutionEngineApprovalManager } from "./approval-manager.js";
import { ExecutionAttemptRunner, type ExecuteAttemptOptions } from "./attempt-runner.js";
import { defaultClock } from "./clock.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import { ExecutionEngineArtifactRecorder } from "./artifact-recorder.js";
import {
  executeWithTimeout as executeWithTimeoutFn,
  releaseConcurrencySlotsTx,
  releaseLaneAndWorkspaceLeasesTx,
  releaseLaneLeaseTx,
  touchLaneLeaseTx,
  tryAcquireConcurrencyForAttemptTx,
  tryAcquireLaneLease,
} from "./concurrency-manager.js";
import { ExecutionEngineEventEmitter } from "./event-emitter.js";
import { normalizeWorkspaceKey, parsePlanIdFromTriggerJson } from "./db.js";
import { toolCallFromAction } from "./tool-call.js";
import { releaseWorkspaceLeaseTx, tryAcquireWorkspaceLeaseTx } from "../../workspace/lease.js";
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
  tenant_id: string;
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

interface RunnableRunRow {
  tenant_id: string;
  run_id: string;
  job_id: string;
  agent_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
  workspace_id: string;
  policy_snapshot_id: string | null;
}

interface StepRow {
  tenant_id: string;
  step_id: string;
  run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTriggerMetadata(triggerJson: string): Record<string, unknown> | undefined {
  const trigger = safeJsonParse(triggerJson, undefined as unknown);
  if (!isRecord(trigger)) return undefined;
  const metadata = trigger["metadata"];
  return isRecord(metadata) ? metadata : undefined;
}

export class ExecutionEngine {
  private readonly db: SqlDb;
  private readonly clock: ClockFn;
  private readonly redactionEngine?: RedactionEngine;
  private readonly secretProviderForTenant?: (tenantId: string) => SecretProvider;
  private readonly logger?: Logger;
  private readonly policyService?: PolicyService;
  private readonly eventsEnabled: boolean;
  private readonly eventEmitter: ExecutionEngineEventEmitter;
  private readonly artifactRecorder: ExecutionEngineArtifactRecorder;
  private readonly approvalManager: ExecutionEngineApprovalManager;
  private readonly attemptRunner: ExecutionAttemptRunner;
  private readonly concurrencyLimits?: ExecutionConcurrencyLimits;

  constructor(opts: {
    db: SqlDb;
    clock?: ClockFn;
    redactionEngine?: RedactionEngine;
    secretProviderForTenant?: (tenantId: string) => SecretProvider;
    logger?: Logger;
    policyService?: PolicyService;
    eventsEnabled?: boolean;
    concurrencyLimits?: ExecutionConcurrencyLimits;
  }) {
    this.db = opts.db;
    this.clock = opts.clock ?? defaultClock;
    this.redactionEngine = opts.redactionEngine;
    this.secretProviderForTenant = opts.secretProviderForTenant;
    this.logger = opts.logger;
    this.policyService = opts.policyService;
    this.eventsEnabled = opts.eventsEnabled ?? true;
    this.concurrencyLimits = opts.concurrencyLimits;
    this.eventEmitter = new ExecutionEngineEventEmitter({
      clock: this.clock,
      eventsEnabled: this.eventsEnabled,
    });
    this.artifactRecorder = new ExecutionEngineArtifactRecorder({
      eventEmitter: this.eventEmitter,
      redactUnknown: (value) => this.redactUnknown(value),
    });
    this.approvalManager = new ExecutionEngineApprovalManager({
      clock: this.clock,
      logger: this.logger,
      redactText: (value) => this.redactText(value),
      redactUnknown: (value) => this.redactUnknown(value),
      eventEmitter: this.eventEmitter,
    });
    this.attemptRunner = new ExecutionAttemptRunner({
      db: this.db,
      clock: this.clock,
      logger: this.logger,
      policyService: this.policyService,
      concurrencyLimits: this.concurrencyLimits,
      redactText: (text) => this.redactText(text),
      redactUnknown: (value) => this.redactUnknown(value),
      executeWithTimeout: async (...args) => await this.executeWithTimeout(...args),
      resolveSecretScopesFromArgs: async (tenantId, args, context) =>
        await this.resolveSecretScopesFromArgs(tenantId, args, context),
      retryOrFailStep: async (opts) => await this.approvalManager.maybeRetryOrFailStep(opts),
      pauseRunForApproval: async (tx, opts, input) =>
        await this.approvalManager.pauseRunForApproval(tx, opts, input),
      recordArtifactsTx: async (tx, scope, artifacts) =>
        await this.recordArtifactsTx(tx, scope, artifacts),
      emitAttemptUpdatedTx: async (tx, attemptId) => await this.emitAttemptUpdatedTx(tx, attemptId),
      emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
    });
  }

  private redactUnknown<T>(value: T): T {
    return this.redactionEngine ? (this.redactionEngine.redactUnknown(value).redacted as T) : value;
  }

  private redactText(text: string): string {
    return this.redactionEngine ? this.redactionEngine.redactText(text).redacted : text;
  }

  private async resolveSecretScopesFromArgs(
    tenantId: string,
    args: unknown,
    context?: { runId?: string; stepId?: string; attemptId?: string },
  ): Promise<string[]> {
    const handleIds = collectSecretHandleIds(args);
    if (handleIds.length === 0) return [];

    const secretProvider = this.secretProviderForTenant?.(tenantId);
    if (!secretProvider) {
      return handleIds;
    }

    try {
      const handles = await secretProvider.list();
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("execution.secret_provider_list_failed", {
        tenant_id: tenantId,
        run_id: context?.runId,
        step_id: context?.stepId,
        attempt_id: context?.attemptId,
        error: message,
      });
      return handleIds;
    }
  }

  private async isApprovedPolicyGateTx(
    tx: SqlDb,
    tenantId: string,
    approvalId: string | null,
  ): Promise<boolean> {
    if (approvalId === null) return false;
    const row = await tx.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE tenant_id = ? AND approval_id = ? LIMIT 1",
      [tenantId, approvalId],
    );
    if (!row) return false;
    return row.kind === "policy" && row.status === "approved";
  }

  private async emitRunUpdatedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.eventEmitter.emitRunUpdatedTx(tx, runId);
  }

  private async emitStepUpdatedTx(tx: SqlDb, stepId: string): Promise<void> {
    await this.eventEmitter.emitStepUpdatedTx(tx, stepId);
  }

  private async emitAttemptUpdatedTx(tx: SqlDb, attemptId: string): Promise<void> {
    await this.eventEmitter.emitAttemptUpdatedTx(tx, attemptId);
  }

  private async emitRunIdEventTx(
    tx: SqlDb,
    type: "run.queued" | "run.started" | "run.resumed" | "run.completed" | "run.failed",
    runId: string,
  ): Promise<void> {
    await this.eventEmitter.emitRunIdEventTx(tx, type, runId);
  }

  private async emitRunQueuedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.queued", runId);
  }

  private async emitRunStartedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.started", runId);
  }

  private async emitRunResumedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.resumed", runId);
  }

  private async emitRunCompletedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.completed", runId);
  }

  private async emitRunFailedTx(tx: SqlDb, runId: string): Promise<void> {
    await this.emitRunIdEventTx(tx, "run.failed", runId);
  }

  private async emitRunCancelledTx(
    tx: SqlDb,
    opts: { runId: string; reason?: string },
  ): Promise<void> {
    await this.eventEmitter.emitRunCancelledTx(tx, opts);
  }

  private async recordArtifactsTx(
    tx: SqlDb,
    scope: {
      tenantId: string;
      runId: string;
      stepId: string;
      attemptId: string;
      workspaceId: string;
      agentId: string | null;
    },
    artifacts: ArtifactRefT[],
  ): Promise<void> {
    await this.artifactRecorder.recordArtifactsTx(tx, scope, artifacts);
  }

  private async resolveWorkspaceScopeForEnqueue(
    tx: SqlDb,
    identityScopeDal: IdentityScopeDal,
    tenantId: string,
    input: EnqueuePlanInput,
  ): Promise<{ workspaceId: string; workspaceKey: string }> {
    const explicitWorkspaceKey = input.workspaceKey?.trim();
    if (explicitWorkspaceKey) {
      const workspaceKey = normalizeWorkspaceKey(explicitWorkspaceKey);
      const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
      return { workspaceId, workspaceKey };
    }

    const legacyWorkspaceInput = input.workspaceId?.trim();
    if (!legacyWorkspaceInput) {
      const workspaceKey = normalizeWorkspaceKey(undefined);
      const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
      return { workspaceId, workspaceKey };
    }

    const existingWorkspace = await tx.get<{ workspace_id: string; workspace_key: string }>(
      `SELECT workspace_id, workspace_key
       FROM workspaces
       WHERE tenant_id = ? AND workspace_id = ?
       LIMIT 1`,
      [tenantId, legacyWorkspaceInput],
    );
    if (existingWorkspace?.workspace_id) {
      return {
        workspaceId: existingWorkspace.workspace_id,
        workspaceKey: existingWorkspace.workspace_key,
      };
    }

    const workspaceKey = normalizeWorkspaceKey(legacyWorkspaceInput);
    const workspaceId = await identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
    return { workspaceId, workspaceKey };
  }

  async enqueuePlanInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    const jobId = randomUUID();
    const runId = randomUUID();
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
      throw new Error("tenantId is required to enqueue execution plans");
    }
    let agentKey = "default";
    try {
      const parsedKey = parseTyrumKey(input.key as never);
      if (parsedKey.kind === "agent") {
        agentKey = parsedKey.agent_key;
      }
    } catch {
      // ignore; treat as default agent
    }

    const identityScopeDal = new IdentityScopeDal(tx);
    const agentId = await identityScopeDal.ensureAgentId(tenantId, agentKey);
    const { workspaceId } = await this.resolveWorkspaceScopeForEnqueue(
      tx,
      identityScopeDal,
      tenantId,
      input,
    );
    await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const baseMetadata = {
      plan_id: input.planId,
      request_id: input.requestId,
      tenant_id: tenantId,
      agent_id: agentId,
      workspace_id: workspaceId,
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
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         key,
         lane,
         status,
         trigger_json,
         input_json,
         latest_run_id,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        tenantId,
        jobId,
        agentId,
        workspaceId,
        input.key,
        input.lane,
        triggerJson,
        inputJson,
        runId,
        input.policySnapshotId ?? null,
      ],
    );

    await tx.run(
      `INSERT INTO execution_runs (
         tenant_id,
         run_id,
         job_id,
         key,
         lane,
         status,
         attempt,
         policy_snapshot_id,
         budgets_json
       )
       VALUES (?, ?, ?, ?, ?, 'queued', 1, ?, ?)`,
      [
        tenantId,
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
           tenant_id,
           step_id,
           run_id,
           step_index,
           status,
           action_json,
           idempotency_key,
           postcondition_json
         ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
        [
          tenantId,
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
    await this.emitRunQueuedTx(tx, runId);
    const stepIds = await tx.all<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
      [tenantId, runId],
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
      tenant_id: input.tenantId,
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
        `SELECT tenant_id, token, run_id, expires_at, revoked_at
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
             WHERE tenant_id = ? AND token = ? AND revoked_at IS NULL`,
            [nowIso, row.tenant_id, token],
          );
          return undefined;
        }
      }

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE tenant_id = ? AND token = ? AND revoked_at IS NULL`,
        [nowIso, row.tenant_id, token],
      );

      const approval = await tx.get<{ kind: string }>(
        "SELECT kind FROM approvals WHERE tenant_id = ? AND resume_token = ? LIMIT 1",
        [row.tenant_id, token],
      );
      const runResumed = await tx.run(
        `UPDATE execution_runs
         SET status = 'queued', paused_reason = NULL, paused_detail = NULL
         WHERE tenant_id = ? AND run_id = ? AND status = 'paused'`,
        [row.tenant_id, row.run_id],
      );
      if (runResumed.changes !== 1) {
        return undefined;
      }

      if (approval?.kind === "budget") {
        await tx.run(
          `UPDATE execution_runs
           SET budget_overridden_at = COALESCE(budget_overridden_at, ?)
           WHERE tenant_id = ? AND run_id = ?`,
          [nowIso, row.tenant_id, row.run_id],
        );
      }

      await tx.run(
        `UPDATE execution_steps
         SET status = 'queued'
         WHERE tenant_id = ? AND run_id = ? AND status = 'paused'`,
        [row.tenant_id, row.run_id],
      );

      await this.emitRunUpdatedTx(tx, row.run_id);
      const stepIds = await tx.all<{ step_id: string }>(
        "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
        [row.tenant_id, row.run_id],
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
      const row = await tx.get<{
        tenant_id: string;
        run_id: string;
        status: string;
        job_id: string;
        key: string;
        lane: string;
      }>(
        `SELECT tenant_id, run_id, status, job_id, key, lane
         FROM execution_runs
         WHERE run_id = ?`,
        [runId],
      );
      if (!row) return "not_found";

      if (row.status === "cancelled") {
        await tx.run(
          `UPDATE resume_tokens
           SET revoked_at = ?
           WHERE tenant_id = ? AND run_id = ? AND revoked_at IS NULL`,
          [nowIso, row.tenant_id, runId],
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
         WHERE tenant_id = ? AND run_id = ?`,
        [nowIso, detail, row.tenant_id, runId],
      );

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'cancelled'
         WHERE tenant_id = ? AND job_id = ?`,
        [row.tenant_id, row.job_id],
      );

      await tx.run(
        `UPDATE execution_steps
         SET status = 'cancelled'
         WHERE tenant_id = ? AND run_id = ?
           AND status IN ('queued', 'paused', 'running')`,
        [row.tenant_id, runId],
      );

      await tx.run(
        `UPDATE resume_tokens
         SET revoked_at = ?
         WHERE tenant_id = ? AND run_id = ? AND revoked_at IS NULL`,
        [nowIso, row.tenant_id, runId],
      );

      // Best-effort: mark any in-flight attempts as cancelled so they don't linger.
      const runningAttempts = await tx.all<{ attempt_id: string }>(
        `SELECT a.attempt_id
         FROM execution_attempts a
         JOIN execution_steps s ON s.tenant_id = a.tenant_id AND s.step_id = a.step_id
         WHERE s.tenant_id = ? AND s.run_id = ? AND a.status = 'running'`,
        [row.tenant_id, runId],
      );
      await tx.run(
        `UPDATE execution_attempts
         SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = COALESCE(error, 'cancelled')
         WHERE tenant_id = ?
           AND status = 'running'
           AND step_id IN (SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ?)`,
        [nowIso, row.tenant_id, row.tenant_id, runId],
      );

      for (const attempt of runningAttempts) {
        await releaseConcurrencySlotsTx(
          tx,
          row.tenant_id,
          attempt.attempt_id,
          nowIso,
          this.concurrencyLimits,
        );
      }

      await this.emitRunUpdatedTx(tx, runId);
      const stepIds = await tx.all<{ step_id: string }>(
        "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
        [row.tenant_id, runId],
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
         r.tenant_id,
         r.run_id,
         r.job_id,
         j.agent_id,
         r.key,
         r.lane,
         r.status,
         j.trigger_json,
         j.workspace_id,
         r.policy_snapshot_id
       FROM execution_runs r
       JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.status IN ('running', 'queued')
         AND NOT EXISTS (
           SELECT 1 FROM execution_runs p
           WHERE p.tenant_id = r.tenant_id
             AND p.key = r.key
             AND p.lane = r.lane
             AND p.status = 'paused'
         )
         ${whereRunId}
       ORDER BY
         CASE r.status WHEN 'running' THEN 0 ELSE 1 END,
         r.created_at ASC
       LIMIT ${String(limit)}`,
      params,
    );

    for (const run of candidates) {
      const leaseOk = await tryAcquireLaneLease(this.db, {
        tenantId: run.tenant_id,
        key: run.key,
        lane: run.lane,
        owner: input.workerId,
        nowMs,
        ttlMs: 60_000,
      });
      if (!leaseOk) continue;

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
        return { kind: "noop" as const };
      }
      if (current.run_status === "cancelled" || current.job_status === "cancelled") {
        await releaseLaneAndWorkspaceLeasesTx(tx, {
          tenantId: run.tenant_id,
          key: run.key,
          lane: run.lane,
          workspaceId: run.workspace_id,
          owner: input.workerId,
        });
        return { kind: "cancelled" as const };
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
          await this.emitRunUpdatedTx(tx, run.run_id);
          if (shouldEmitRunStarted) {
            await this.emitRunStartedTx(tx, run.run_id);
          }
        }
      }

      await tx.run(
        `UPDATE execution_jobs
         SET status = 'running'
         WHERE tenant_id = ? AND job_id = ? AND status = 'queued'`,
        [run.tenant_id, run.job_id],
      );

      // Find next incomplete step.
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
        // Finalize run if all steps are terminal.
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
        await this.emitRunUpdatedTx(tx, run.run_id);
        if (runUpdated.changes === 1) {
          if (failed) {
            await this.emitRunFailedTx(tx, run.run_id);
          } else {
            await this.emitRunCompletedTx(tx, run.run_id);
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
          owner: input.workerId,
        });

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
          await this.emitAttemptUpdatedTx(tx, latestAttempt.attempt_id);
          await releaseConcurrencySlotsTx(
            tx,
            next.tenant_id,
            latestAttempt.attempt_id,
            clock.nowIso,
            this.concurrencyLimits,
          );
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
          reasons.push(
            `elapsed_ms=${String(elapsedMs)} > max_duration_ms=${String(maxDurationMs)}`,
          );
        }

        if (reasons.length > 0) {
          const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
          const paused = await this.approvalManager.pauseRunForApproval(
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
        this.logger?.warn("execution.step_action_parse_failed", {
          run_id: run.run_id,
          step_id: next.step_id,
          error: message,
        });
      }

      // Enforce per-step policy decisions when a run carries a snapshot.
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
            this.logger?.warn("execution.policy_snapshot_invalid", {
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
              // Fail closed: if we can't parse the stored snapshot, do not allow overrides to auto-allow.
              // Observe-only deployments keep their non-blocking behavior.
              if (this.policyService?.isEnabled() && this.policyService.isObserveOnly()) {
                return "allow";
              }
              return "require_approval";
            }

            if (this.policyService?.isEnabled()) {
              const evaluation = await this.policyService.evaluateToolCallFromSnapshot({
                tenantId: run.tenant_id,
                policySnapshotId,
                agentId: run.agent_id,
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
              if (runUpdated.changes === 1) {
                await this.emitRunUpdatedTx(tx, run.run_id);
                await this.emitRunFailedTx(tx, run.run_id);
              }
              await releaseLaneAndWorkspaceLeasesTx(tx, {
                tenantId: run.tenant_id,
                key: run.key,
                lane: run.lane,
                workspaceId: run.workspace_id,
                owner: input.workerId,
              });

              await this.emitStepUpdatedTx(tx, next.step_id);
              await this.emitAttemptUpdatedTx(tx, attemptId);
              return { kind: "recovered" as const };
            }

            // Fail closed: if we can't atomically transition the queued step to a terminal
            // state, do not proceed to execute the policy-denied action.
            return { kind: "noop" as const };
          }

          if (decision === "require_approval") {
            const alreadyApproved = await this.isApprovedPolicyGateTx(
              tx,
              run.tenant_id,
              next.approval_id,
            );

            if (!alreadyApproved) {
              const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
              const paused = await this.approvalManager.pauseRunForApproval(
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

            await this.emitStepUpdatedTx(tx, next.step_id);
            await this.emitAttemptUpdatedTx(tx, attemptId);
            return { kind: "idempotent" as const };
          }
        }
      }

      const toolIntentPause = await this.maybePauseForToolIntentGuardrailTx(tx, {
        run,
        step: next,
        actionType,
        action: parsedAction,
        clock,
        workerId: input.workerId,
      });
      if (toolIntentPause) {
        return {
          kind: "paused" as const,
          reason: "approval" as const,
          approvalId: toolIntentPause.approvalId,
        };
      }

      const policy = this.policyService;
      if (
        policy &&
        policy.isEnabled() &&
        !policy.isObserveOnly() &&
        parsedAction &&
        (actionType === "CLI" || actionType === "Http")
      ) {
        const secretScopes = await this.resolveSecretScopesFromArgs(
          next.tenant_id,
          parsedAction.args ?? {},
          {
            runId: run.run_id,
            stepId: next.step_id,
          },
        );

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
              return { kind: "noop" as const };
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
                this.redactText(
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
              owner: input.workerId,
            });

            await this.emitAttemptUpdatedTx(tx, attemptId);
            await this.emitRunUpdatedTx(tx, run.run_id);
            if (runUpdated.changes === 1) {
              await this.emitRunFailedTx(tx, run.run_id);
            }

            const stepIds = await tx.all<{ step_id: string }>(
              "SELECT step_id FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC",
              [run.tenant_id, run.run_id],
            );
            for (const row of stepIds) {
              await this.emitStepUpdatedTx(tx, row.step_id);
            }

            return { kind: "finalized" as const };
          }

          if (secretsDecision === "require_approval") {
            const alreadyApproved = await this.isApprovedPolicyGateTx(
              tx,
              run.tenant_id,
              next.approval_id,
            );
            if (!alreadyApproved) {
              const planId = parsePlanIdFromTriggerJson(run.trigger_json) ?? run.run_id;
              const paused = await this.approvalManager.pauseRunForApproval(
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

      const agentId = run.agent_id;
      const capability = actionType ? requiredCapability(actionType) : undefined;

      const concurrencyOk = await tryAcquireConcurrencyForAttemptTx(
        tx,
        {
          tenantId: run.tenant_id,
          attemptId,
          owner: input.workerId,
          nowMs: clock.nowMs,
          nowIso: clock.nowIso,
          ttlMs: leaseTtlMs,
          agentId,
          capability,
        },
        this.concurrencyLimits,
      );
      if (!concurrencyOk) {
        return { kind: "noop" as const };
      }

      const needsWorkspaceLease = actionType === "CLI";
      if (needsWorkspaceLease) {
        const workspaceOk = await tryAcquireWorkspaceLeaseTx(tx, {
          tenantId: run.tenant_id,
          workspaceId: run.workspace_id,
          owner: input.workerId,
          nowMs: clock.nowMs,
          ttlMs: leaseTtlMs,
        });
        if (!workspaceOk) {
          await releaseConcurrencySlotsTx(
            tx,
            run.tenant_id,
            attemptId,
            clock.nowIso,
            this.concurrencyLimits,
          );
          await releaseLaneLeaseTx(tx, {
            tenantId: run.tenant_id,
            key: run.key,
            lane: run.lane,
            owner: input.workerId,
          });
          return { kind: "noop" as const };
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
            owner: input.workerId,
          });
        }
        await releaseConcurrencySlotsTx(
          tx,
          run.tenant_id,
          attemptId,
          clock.nowIso,
          this.concurrencyLimits,
        );
        return { kind: "noop" as const };
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
          input.workerId,
          clock.nowMs + leaseTtlMs,
        ],
      );

      await touchLaneLeaseTx(tx, {
        tenantId: run.tenant_id,
        key: run.key,
        lane: run.lane,
        owner: input.workerId,
        expiresAtMs: clock.nowMs + leaseTtlMs,
      });

      await this.emitStepUpdatedTx(tx, next.step_id);
      await this.emitAttemptUpdatedTx(tx, attemptId);
      return {
        kind: "claimed" as const,
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
      tenantId: outcome.tenantId,
      runId: outcome.runId,
      jobId: outcome.jobId,
      agentId: outcome.agentId,
      workspaceId: outcome.workspaceId,
      key: outcome.key,
      lane: outcome.lane,
      stepId: outcome.step.step_id,
      attemptId: outcome.attempt.attemptId,
      attemptNum: outcome.attempt.attemptNum,
      workerId: input.workerId,
      executor: input.executor,
    });
  }

  private async executeAttempt(opts: ExecuteAttemptOptions): Promise<boolean> {
    return await this.attemptRunner.executeAttempt(opts);
  }

  private async maybePauseForToolIntentGuardrailTx(
    tx: SqlDb,
    opts: {
      run: RunnableRunRow;
      step: StepRow;
      actionType: ActionPrimitiveT["type"] | undefined;
      action: ActionPrimitiveT | undefined;
      clock: ExecutionClock;
      workerId: string;
    },
  ): Promise<{ approvalId: string } | undefined> {
    if (!opts.actionType) return undefined;
    if (!requiresPostcondition(opts.actionType)) return undefined;

    const metadata = parseTriggerMetadata(opts.run.trigger_json);
    const workItemIdRaw = metadata?.["work_item_id"];
    const workItemId = typeof workItemIdRaw === "string" ? workItemIdRaw.trim() : "";
    if (workItemId.length === 0) return undefined;

    const existingApproval = await tx.get<{ n: number }>(
      `SELECT 1 AS n
       FROM approvals
       WHERE tenant_id = ?
         AND run_id = ?
         AND step_id = ?
         AND kind = 'intent'
         AND status = 'approved'
       LIMIT 1`,
      [opts.run.tenant_id, opts.run.run_id, opts.step.step_id],
    );
    if (existingApproval) return undefined;

    const scope = {
      tenant_id: opts.run.tenant_id,
      agent_id: opts.run.agent_id,
      workspace_id: opts.run.workspace_id,
    } as const;

    const dal = new WorkboardDal(tx);

    const planId = parsePlanIdFromTriggerJson(opts.run.trigger_json) ?? opts.run.run_id;

    const item = await dal.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      const paused = await this.approvalManager.pauseRunForApproval(
        tx,
        {
          tenantId: opts.run.tenant_id,
          agentId: opts.run.agent_id,
          workspaceId: opts.run.workspace_id,
          planId,
          stepIndex: opts.step.step_index,
          runId: opts.run.run_id,
          stepId: opts.step.step_id,
          jobId: opts.run.job_id,
          key: opts.run.key,
          lane: opts.run.lane,
          workerId: opts.workerId,
        },
        {
          kind: "intent",
          prompt: "Intent guardrail — work item not found",
          detail: `work_item_id=${workItemId} not found in scope; pausing before side-effecting step execution`,
          context: {
            work_item_id: workItemId,
            action_type: opts.actionType,
            step_index: opts.step.step_index,
          },
        },
      );
      return { approvalId: paused.approvalId };
    }

    const { entries } = await dal.listStateKv({
      scope: { ...scope, kind: "work_item", work_item_id: workItemId },
    });
    const stateKv: Record<string, unknown> = {};
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry["key"] === "string") {
        stateKv[entry["key"]] = entry["value_json"];
      }
    }

    const { decisions } = await dal.listDecisions({ scope, work_item_id: workItemId, limit: 50 });
    const decisionIds = decisions
      .map((d) => d.decision_id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const intentGraphSha256 = sha256HexFromString(
      stableJsonStringify({
        v: 1,
        work_item_id: workItemId,
        acceptance: item.acceptance ?? null,
        state_kv: stateKv,
        decision_ids: decisionIds,
        policy_snapshot_id: opts.run.policy_snapshot_id ?? null,
      }),
    );

    const { artifacts } = await dal.listArtifacts({ scope, work_item_id: workItemId, limit: 200 });
    const toolIntent = artifacts
      .filter((a) => a.kind === "tool_intent")
      .find((a) => {
        const prov = a.provenance_json;
        if (!isRecord(prov)) return false;
        const runId = prov["run_id"];
        const stepIndex = prov["step_index"];
        return runId === opts.run.run_id && stepIndex === opts.step.step_index;
      });

    const resolveToolIntentError = (): string | undefined => {
      if (!toolIntent) return "missing ToolIntent (kind=tool_intent) for this step";
      const prov = toolIntent.provenance_json;
      if (!isRecord(prov)) return "ToolIntent provenance_json must be an object";

      const goal = typeof prov["goal"] === "string" ? prov["goal"].trim() : "";
      const expectedValue =
        typeof prov["expected_value"] === "string" ? prov["expected_value"].trim() : "";
      const sideEffectClass =
        typeof prov["side_effect_class"] === "string" ? prov["side_effect_class"].trim() : "";
      const riskClass = typeof prov["risk_class"] === "string" ? prov["risk_class"].trim() : "";
      const expectedEvidence = prov["expected_evidence"];
      const budget = prov["cost_budget"];
      const budgetOk =
        isRecord(budget) &&
        (normalizeNonnegativeInt(budget["max_usd_micros"]) !== undefined ||
          normalizePositiveInt(budget["max_duration_ms"]) !== undefined ||
          normalizeNonnegativeInt(budget["max_total_tokens"]) !== undefined);
      const claimedSha =
        typeof prov["intent_graph_sha256"] === "string" ? prov["intent_graph_sha256"].trim() : "";

      if (!goal) return "ToolIntent.goal is required";
      if (!expectedValue) return "ToolIntent.expected_value is required";
      if (!budgetOk) return "ToolIntent.cost_budget is required";
      if (!sideEffectClass) return "ToolIntent.side_effect_class is required";
      if (!riskClass) return "ToolIntent.risk_class is required";
      if (expectedEvidence === undefined) return "ToolIntent.expected_evidence is required";
      if (!claimedSha) return "ToolIntent.intent_graph_sha256 is required";
      if (claimedSha !== intentGraphSha256) {
        return "ToolIntent intent_graph_sha256 does not match current intent graph";
      }
      return undefined;
    };

    const error = resolveToolIntentError();
    if (!error) return undefined;

    let artifactId: string | undefined;
    let decisionId: string | undefined;
    const evidenceSavepoint = `tyrum_intent_guardrail_evidence_${String(opts.step.step_index)}`;
    let evidenceSavepointCreated = false;
    try {
      await tx.exec(`SAVEPOINT ${evidenceSavepoint}`);
      evidenceSavepointCreated = true;

      const report = await dal.createArtifact({
        scope,
        artifact: {
          work_item_id: workItemId,
          kind: "verification_report",
          title: "Intent guardrail: pause before side effect",
          body_md: [
            `Blocked side-effecting step due to ToolIntent deviation.`,
            ``,
            `- run_id: \`${opts.run.run_id}\``,
            `- step_index: \`${String(opts.step.step_index)}\``,
            `- action_type: \`${opts.actionType}\``,
            `- reason: ${error}`,
            `- intent_graph_sha256: \`${intentGraphSha256}\``,
            toolIntent ? `- tool_intent_artifact_id: \`${toolIntent.artifact_id}\`` : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
          refs: [`run:${opts.run.run_id}`, `step:${String(opts.step.step_index)}`],
          created_by_run_id: opts.run.run_id,
          provenance_json: {
            v: 1,
            kind: "intent_guardrail",
            reason: error,
            intent_graph_sha256: intentGraphSha256,
            run_id: opts.run.run_id,
            step_index: opts.step.step_index,
            action_type: opts.actionType,
            tool_intent_artifact_id: toolIntent?.artifact_id,
          },
        },
        createdAtIso: opts.clock.nowIso,
      });
      artifactId = report.artifact_id;

      const decision = await dal.createDecision({
        scope,
        decision: {
          work_item_id: workItemId,
          question: `Proceed with side-effecting step ${String(opts.step.step_index)}?`,
          chosen: "pause_and_escalate",
          alternatives: ["proceed_without_tool_intent", "cancel_step_or_run"],
          rationale_md: [
            `Pausing execution before a side-effecting step because ToolIntent validation failed.`,
            ``,
            `Reason: ${error}`,
            ``,
            `Expected intent graph hash: \`${intentGraphSha256}\``,
            artifactId ? `Evidence artifact: \`${artifactId}\`` : undefined,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
          input_artifact_ids: artifactId ? [artifactId] : [],
          created_by_run_id: opts.run.run_id,
        },
        createdAtIso: opts.clock.nowIso,
      });
      decisionId = decision.decision_id;

      await tx.exec(`RELEASE SAVEPOINT ${evidenceSavepoint}`);
    } catch (err) {
      if (evidenceSavepointCreated) {
        try {
          await tx.exec(`ROLLBACK TO SAVEPOINT ${evidenceSavepoint}`);
          await tx.exec(`RELEASE SAVEPOINT ${evidenceSavepoint}`);
        } catch (rollbackErr) {
          const rollbackMessage =
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          this.logger?.warn("intent_guardrail.evidence_rollback_failed", {
            run_id: opts.run.run_id,
            step_id: opts.step.step_id,
            error: rollbackMessage,
          });
        }
      }

      artifactId = undefined;
      decisionId = undefined;
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("intent_guardrail.evidence_write_failed", {
        run_id: opts.run.run_id,
        step_id: opts.step.step_id,
        error: message,
      });
    }

    const paused = await this.approvalManager.pauseRunForApproval(
      tx,
      {
        tenantId: opts.run.tenant_id,
        agentId: opts.run.agent_id,
        workspaceId: opts.run.workspace_id,
        planId,
        stepIndex: opts.step.step_index,
        runId: opts.run.run_id,
        stepId: opts.step.step_id,
        jobId: opts.run.job_id,
        key: opts.run.key,
        lane: opts.run.lane,
        workerId: opts.workerId,
      },
      {
        kind: "intent",
        prompt: "Intent guardrail — ToolIntent required",
        detail: error,
        context: {
          work_item_id: workItemId,
          action_type: opts.actionType,
          step_index: opts.step.step_index,
          intent_graph_sha256: intentGraphSha256,
          tool_intent_artifact_id: toolIntent?.artifact_id,
          work_artifact_id: artifactId,
          decision_id: decisionId,
        },
      },
    );
    return { approvalId: paused.approvalId };
  }

  private async executeWithTimeout(
    executor: StepExecutor,
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    return await executeWithTimeoutFn(executor, action, planId, stepIndex, timeoutMs, context);
  }
}
