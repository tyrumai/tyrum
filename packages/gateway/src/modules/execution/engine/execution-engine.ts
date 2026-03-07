import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
} from "@tyrum/schemas";
import { requiresPostcondition } from "@tyrum/schemas";
import type { RedactionEngine } from "../../redaction/engine.js";
import type { Logger } from "../../observability/logger.js";
import type { PolicyService } from "../../policy/service.js";
import type { SecretProvider } from "../../secret/provider.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import type { SqlDb } from "../../../statestore/types.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { sha256HexFromString, stableJsonStringify } from "../../policy/canonical-json.js";
import { ExecutionEngineApprovalManager } from "./approval-manager.js";
import { ExecutionAttemptRunner, type ExecuteAttemptOptions } from "./attempt-runner.js";
import { defaultClock } from "./clock.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import { ExecutionEngineArtifactRecorder } from "./artifact-recorder.js";
import { executeWithTimeout as executeWithTimeoutFn } from "./concurrency-manager.js";
import { ExecutionEngineEventEmitter } from "./event-emitter.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
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
import { listRunnableRunCandidates, tryAcquireRunLaneLease } from "./leasing.js";
import { enqueuePlan, enqueuePlanInTx } from "./queueing.js";
import { cancelRun, resumeRun } from "./run-control.js";
import { claimStepExecution } from "./step-execution.js";
import {
  isRecord,
  normalizeNonnegativeInt,
  parseTriggerMetadata,
  type RunnableRunRow,
  type StepRow,
} from "./shared.js";

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

  async enqueuePlanInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlanInTx(
      {
        db: this.db,
        logger: this.logger,
        emitRunUpdatedTx: async (innerTx, runId) => await this.emitRunUpdatedTx(innerTx, runId),
        emitRunQueuedTx: async (innerTx, runId) => await this.emitRunQueuedTx(innerTx, runId),
        emitStepUpdatedTx: async (innerTx, stepId) => await this.emitStepUpdatedTx(innerTx, stepId),
        emitAttemptUpdatedTx: async (innerTx, attemptId) =>
          await this.emitAttemptUpdatedTx(innerTx, attemptId),
      },
      tx,
      input,
    );
  }

  async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await enqueuePlan(
      {
        db: this.db,
        logger: this.logger,
        emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
        emitRunQueuedTx: async (tx, runId) => await this.emitRunQueuedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) => await this.emitAttemptUpdatedTx(tx, attemptId),
      },
      input,
    );
  }

  /**
   * Resume a paused run using an opaque token.
   *
   * Returns the resumed run id on success, otherwise `undefined`.
   */
  async resumeRun(token: string): Promise<string | undefined> {
    return await resumeRun(
      {
        db: this.db,
        clock: this.clock,
        redactText: (text) => this.redactText(text),
        concurrencyLimits: this.concurrencyLimits,
        emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) => await this.emitAttemptUpdatedTx(tx, attemptId),
        emitRunResumedTx: async (tx, runId) => await this.emitRunResumedTx(tx, runId),
        emitRunCancelledTx: async (tx, opts) => await this.emitRunCancelledTx(tx, opts),
      },
      token,
    );
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    return await cancelRun(
      {
        db: this.db,
        clock: this.clock,
        redactText: (text) => this.redactText(text),
        concurrencyLimits: this.concurrencyLimits,
        emitRunUpdatedTx: async (tx, runIdValue) => await this.emitRunUpdatedTx(tx, runIdValue),
        emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
        emitAttemptUpdatedTx: async (tx, attemptId) => await this.emitAttemptUpdatedTx(tx, attemptId),
        emitRunResumedTx: async (tx, runIdValue) => await this.emitRunResumedTx(tx, runIdValue),
        emitRunCancelledTx: async (tx, opts) => await this.emitRunCancelledTx(tx, opts),
      },
      runId,
      reason,
    );
  }

  async workerTick(input: WorkerTickInput): Promise<boolean> {
    const { nowMs, nowIso } = this.clock();
    const candidates = await listRunnableRunCandidates(this.db, input.runId);

    for (const run of candidates) {
      const leaseOk = await tryAcquireRunLaneLease(this.db, run, input.workerId, nowMs);
      if (!leaseOk) continue;

      try {
        const outcome = await claimStepExecution(
          {
            db: this.db,
            logger: this.logger,
            policyService: this.policyService,
            approvalManager: this.approvalManager,
            concurrencyLimits: this.concurrencyLimits,
            redactText: (text) => this.redactText(text),
            redactUnknown: (value) => this.redactUnknown(value),
            emitRunUpdatedTx: async (tx, runId) => await this.emitRunUpdatedTx(tx, runId),
            emitStepUpdatedTx: async (tx, stepId) => await this.emitStepUpdatedTx(tx, stepId),
            emitAttemptUpdatedTx: async (tx, attemptId) =>
              await this.emitAttemptUpdatedTx(tx, attemptId),
            emitRunStartedTx: async (tx, runId) => await this.emitRunStartedTx(tx, runId),
            emitRunCompletedTx: async (tx, runId) => await this.emitRunCompletedTx(tx, runId),
            emitRunFailedTx: async (tx, runId) => await this.emitRunFailedTx(tx, runId),
            isApprovedPolicyGateTx: async (tx, tenantId, approvalId) =>
              await this.isApprovedPolicyGateTx(tx, tenantId, approvalId),
            resolveSecretScopesFromArgs: async (tenantId, args, context) =>
              await this.resolveSecretScopesFromArgs(tenantId, args, context),
            maybePauseForToolIntentGuardrailTx: async (tx, opts) =>
              await this.maybePauseForToolIntentGuardrailTx(tx, opts),
          },
          run,
          input.workerId,
          { nowMs, nowIso },
        );
        const didWork = await this.executeClaimedStep(outcome, input);
        if (didWork) return true;
      } finally {
        // Lane leases are held across the whole run while it's active.
        // The tick function releases on completion/failure. On transient
        // errors we still keep the lease for a short TTL to reduce stampedes.
      }
    }

    return false;
  }

  private async executeClaimedStep(
    outcome: Awaited<ReturnType<typeof claimStepExecution>>,
    input: WorkerTickInput,
  ): Promise<boolean> {
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
