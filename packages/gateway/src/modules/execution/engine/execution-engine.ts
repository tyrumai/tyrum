import type {
  ActionPrimitive as ActionPrimitiveT,
  ArtifactRef as ArtifactRefT,
} from "@tyrum/contracts";
import { parseTyrumKey, WorkspaceKey } from "@tyrum/contracts";
import {
  defaultExecutionClock,
  ExecutionEngine as RuntimeExecutionEngine,
  type ClockFn,
  type EnqueuePlanInput,
  type EnqueuePlanResult,
  type ExecutionConcurrencyLimits,
  type StepExecutionContext,
  type StepExecutor,
  type StepResult,
  type WorkerTickInput,
} from "@tyrum/runtime-execution";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../../statestore/types.js";
import { IdentityScopeDal, requirePrimaryAgentId } from "../../identity/scope.js";
import type { Logger } from "../../observability/logger.js";
import type { RedactionEngine } from "../../redaction/engine.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { createSecretHandleResolver } from "../../secret/handle-resolver.js";
import type { SecretProvider } from "../../secret/provider.js";
import { ExecutionAttemptRunner } from "./attempt-runner.js";
import { ExecutionEngineApprovalManager } from "./approval-manager.js";
import { ExecutionEngineArtifactRecorder } from "./artifact-recorder.js";
import {
  executeWithTimeout as executeWithTimeoutFn,
  releaseConcurrencySlotsTx,
} from "./concurrency-manager.js";
import { ExecutionEngineEventEmitter } from "./event-emitter.js";
import { maybePauseForToolIntentGuardrailTx } from "./execution-engine-intent-guardrail.js";
import { listRunnableTurnCandidates, tryAcquireTurnConversationLease } from "./leasing.js";
import { claimStepExecution } from "./step-execution.js";
import { normalizeWorkspaceKey } from "./db.js";
import { WorkflowRunMaterializer } from "./workflow-run-materialization.js";

async function resolveExecutionAgentId(tx: SqlDb, tenantId: string, key: string): Promise<string> {
  const identityScopeDal = new IdentityScopeDal(tx);
  try {
    const parsedKey = parseTyrumKey(key as never);
    if (parsedKey.kind === "agent") {
      return await identityScopeDal.ensureAgentId(tenantId, parsedKey.agent_key);
    }
  } catch {
    // Execution keys are broader than agent-scoped conversation keys; fall back to the
    // existing primary agent for internal workflow conversations that do not encode an agent key.
  }

  return await requirePrimaryAgentId(identityScopeDal, tenantId);
}

async function resolveWorkspaceId(
  tx: SqlDb,
  tenantId: string,
  input: EnqueuePlanInput,
): Promise<string> {
  const identityScopeDal = new IdentityScopeDal(tx);
  const explicitWorkspaceKey = input.workspaceKey?.trim();
  if (explicitWorkspaceKey) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, explicitWorkspaceKey);
  }

  const legacyWorkspace = input.workspaceId?.trim();
  if (!legacyWorkspace) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, normalizeWorkspaceKey(undefined));
  }

  const existing = await tx.get<{ workspace_id: string }>(
    "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_id = ? LIMIT 1",
    [tenantId, legacyWorkspace],
  );
  if (existing?.workspace_id) {
    return existing.workspace_id;
  }

  if (WorkspaceKey.safeParse(legacyWorkspace).success) {
    return await identityScopeDal.ensureWorkspaceId(tenantId, legacyWorkspace);
  }

  return await identityScopeDal.ensureWorkspaceId(tenantId, normalizeWorkspaceKey(legacyWorkspace));
}

export class ExecutionEngine extends RuntimeExecutionEngine<SqlDb> {
  private readonly eventEmitter: ExecutionEngineEventEmitter;
  private readonly workflowRunMaterializer: WorkflowRunMaterializer;

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
    const clock = opts.clock ?? defaultExecutionClock;
    const redactUnknown = <T>(value: T): T =>
      opts.redactionEngine ? (opts.redactionEngine.redactUnknown(value).redacted as T) : value;
    const redactText = (text: string): string =>
      opts.redactionEngine ? opts.redactionEngine.redactText(text).redacted : text;
    const resolveSecretScopesFromArgs = async (
      tenantId: string,
      args: unknown,
      context?: { turnId?: string; stepId?: string; attemptId?: string },
    ): Promise<string[]> => {
      const handleIds = collectSecretHandleIds(args);
      if (handleIds.length === 0) return [];

      const secretProvider = opts.secretProviderForTenant?.(tenantId);
      if (!secretProvider) {
        return handleIds;
      }

      try {
        return await createSecretHandleResolver(secretProvider).resolveScopes(handleIds);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.logger?.warn("execution.secret_provider_list_failed", {
          tenant_id: tenantId,
          turn_id: context?.turnId,
          step_id: context?.stepId,
          attempt_id: context?.attemptId,
          error: message,
        });
        return handleIds;
      }
    };
    const eventEmitter = new ExecutionEngineEventEmitter({
      clock,
      eventsEnabled: opts.eventsEnabled ?? true,
    });
    const emitTurnUpdatedTx = async (tx: SqlDb, turnId: string) =>
      await eventEmitter.emitTurnUpdatedTx(tx, turnId);
    const emitStepUpdatedTx = async (tx: SqlDb, stepId: string) =>
      await eventEmitter.emitStepUpdatedTx(tx, stepId);
    const emitAttemptUpdatedTx = async (tx: SqlDb, attemptId: string) =>
      await eventEmitter.emitAttemptUpdatedTx(tx, attemptId);
    const emitTurnLifecycleEventTx = async (
      tx: SqlDb,
      type: "turn.queued" | "turn.started" | "turn.resumed" | "turn.completed" | "turn.failed",
      turnId: string,
    ) => await eventEmitter.emitTurnLifecycleEventTx(tx, type, turnId);
    const emitTurnQueuedTx = async (tx: SqlDb, turnId: string) =>
      await emitTurnLifecycleEventTx(tx, "turn.queued", turnId);
    const emitTurnStartedTx = async (tx: SqlDb, turnId: string) =>
      await emitTurnLifecycleEventTx(tx, "turn.started", turnId);
    const emitTurnResumedTx = async (tx: SqlDb, turnId: string) =>
      await emitTurnLifecycleEventTx(tx, "turn.resumed", turnId);
    const emitTurnCompletedTx = async (tx: SqlDb, turnId: string) =>
      await emitTurnLifecycleEventTx(tx, "turn.completed", turnId);
    const emitTurnFailedTx = async (tx: SqlDb, turnId: string) =>
      await emitTurnLifecycleEventTx(tx, "turn.failed", turnId);
    const emitTurnCancelledTx = async (
      tx: SqlDb,
      cancelOpts: { turnId: string; reason?: string },
    ) => await eventEmitter.emitTurnCancelledTx(tx, cancelOpts);
    const artifactRecorder = new ExecutionEngineArtifactRecorder({
      eventEmitter,
      redactUnknown: (value) => redactUnknown(value),
    });
    const recordArtifactsTx = async (
      tx: SqlDb,
      scope: {
        tenantId: string;
        turnId: string;
        stepId: string;
        attemptId: string;
        workspaceId: string;
        agentId: string | null;
      },
      artifacts: ArtifactRefT[],
    ) => await artifactRecorder.recordArtifactsTx(tx, scope, artifacts);
    const approvalManager = new ExecutionEngineApprovalManager({
      clock,
      logger: opts.logger,
      policyService: opts.policyService,
      redactText: (value) => redactText(value),
      redactUnknown: (value) => redactUnknown(value),
      eventEmitter,
    });
    const isApprovedPolicyGateTx = async (
      tx: SqlDb,
      tenantId: string,
      approvalId: string | null,
    ): Promise<boolean> => {
      if (approvalId === null) return false;
      const row = await tx.get<{ kind: string; status: string }>(
        "SELECT kind, status FROM approvals WHERE tenant_id = ? AND approval_id = ? LIMIT 1",
        [tenantId, approvalId],
      );
      if (!row) return false;
      return row.kind === "policy" && row.status === "approved";
    };
    let attemptRunner!: ExecutionAttemptRunner;

    super({
      db: opts.db,
      clock,
      logger: opts.logger,
      concurrencyLimits: opts.concurrencyLimits,
      scopeResolver: {
        resolveExecutionAgentId: async (tx, tenantId, key) =>
          await resolveExecutionAgentId(tx, tenantId, key),
        resolveWorkspaceId: async (tx, tenantId, input) =>
          await resolveWorkspaceId(tx, tenantId, input),
        ensureMembership: async (tx, tenantId, agentId, workspaceId) => {
          const identityScopeDal = new IdentityScopeDal(tx);
          await identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
        },
      },
      releaseConcurrencySlotsTx: async (tx, tenantId, attemptId, nowIso, limits) =>
        await releaseConcurrencySlotsTx(tx, tenantId, attemptId, nowIso, limits),
      listRunnableTurnCandidates: async (turnId) =>
        await listRunnableTurnCandidates(opts.db, turnId),
      tryAcquireTurnConversationLease: async (run, workerId, nowMs) =>
        await tryAcquireTurnConversationLease(opts.db, run, workerId, nowMs),
      claimStepExecution: async (run, workerId, engineClock) =>
        await claimStepExecution(
          {
            db: opts.db,
            logger: opts.logger,
            policyService: opts.policyService,
            approvalManager,
            concurrencyLimits: opts.concurrencyLimits,
            redactText: (text) => redactText(text),
            redactUnknown: (value) => redactUnknown(value),
            emitTurnUpdatedTx,
            emitStepUpdatedTx,
            emitAttemptUpdatedTx,
            emitTurnStartedTx,
            emitTurnCompletedTx,
            emitTurnFailedTx,
            isApprovedPolicyGateTx,
            resolveSecretScopesFromArgs,
            maybePauseForToolIntentGuardrailTx: async (tx, guardrailOpts) =>
              await maybePauseForToolIntentGuardrailTx(
                { logger: opts.logger, approvalManager },
                tx,
                guardrailOpts,
              ),
          },
          run,
          workerId,
          engineClock,
        ),
      executeAttempt: async (executeOpts) => await attemptRunner.executeAttempt(executeOpts),
      emitTurnUpdatedTx,
      emitStepUpdatedTx,
      emitAttemptUpdatedTx,
      emitTurnQueuedTx,
      emitTurnResumedTx,
      emitTurnCancelledTx,
      redactText,
    });

    attemptRunner = new ExecutionAttemptRunner({
      db: opts.db,
      clock,
      logger: opts.logger,
      policyService: opts.policyService,
      concurrencyLimits: opts.concurrencyLimits,
      redactText: (text) => redactText(text),
      redactUnknown: (value) => redactUnknown(value),
      executeWithTimeout: async (...args) => await this.executeWithTimeout(...args),
      resolveSecretScopesFromArgs,
      retryOrFailStep: async (retryOptions) =>
        await approvalManager.maybeRetryOrFailStep(retryOptions),
      pauseRunForApproval: async (tx, pauseOptions, input) =>
        await approvalManager.pauseRunForApproval(tx, pauseOptions, input),
      recordArtifactsTx,
      emitAttemptUpdatedTx,
      emitStepUpdatedTx,
    });

    this.eventEmitter = eventEmitter;
    this.workflowRunMaterializer = new WorkflowRunMaterializer({
      db: opts.db,
      logger: opts.logger,
      materializeExecutionStateInTx: async (tx, input) => {
        await super.enqueuePlanInTx(tx, input);
      },
    });
    Object.defineProperty(this, "approvalManager", {
      value: approvalManager,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }

  protected async emitTurnLifecycleEventTx(
    tx: SqlDb,
    type: "turn.queued" | "turn.started" | "turn.resumed" | "turn.completed" | "turn.failed",
    turnId: string,
  ): Promise<void> {
    await this.eventEmitter.emitTurnLifecycleEventTx(tx, type, turnId);
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

  // Keep the gateway surface typed and explicit even though the runtime core now
  // owns the orchestration methods.
  override async enqueuePlanInTx(tx: SqlDb, input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await super.enqueuePlanInTx(tx, input);
  }

  override async enqueuePlan(input: EnqueuePlanInput): Promise<EnqueuePlanResult> {
    return await super.enqueuePlan(input);
  }

  override async resumeTurn(token: string): Promise<string | undefined> {
    const turnId = await super.resumeTurn(token);
    if (turnId) {
      await this.workflowRunMaterializer.syncWorkflowRunFromTurn(turnId);
    }
    return turnId;
  }

  override async cancelTurn(
    turnId: string,
    reason?: string,
  ): Promise<"cancelled" | "already_terminal" | "not_found"> {
    const outcome = await super.cancelTurn(turnId, reason);
    if (outcome !== "not_found") {
      await this.workflowRunMaterializer.syncWorkflowRunFromTurn(turnId);
      return outcome;
    }
    const workflowRunOutcome = await this.workflowRunMaterializer.cancelIfPresent(turnId);
    if (workflowRunOutcome !== "cancelled") {
      return workflowRunOutcome;
    }

    const lateTurnOutcome = await super.cancelTurn(turnId, reason);
    if (lateTurnOutcome !== "not_found") {
      await this.workflowRunMaterializer.syncWorkflowRunFromTurn(turnId);
    }
    return "cancelled";
  }

  override async workerTick(input: WorkerTickInput): Promise<boolean> {
    if (input.turnId) {
      await this.workflowRunMaterializer.materializeIfNeeded(input.turnId);
    } else {
      await this.workflowRunMaterializer.materializeNextQueued();
    }

    const didWork = await super.workerTick(input);
    if (input.turnId) {
      await this.workflowRunMaterializer.syncWorkflowRunFromTurn(input.turnId);
    }
    return didWork;
  }
}
