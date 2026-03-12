import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  NormalizedContainerKind,
  NormalizedMessageEnvelope as NormalizedMessageEnvelopeT,
  WorkScope,
} from "@tyrum/schemas";
import { AgentTurnRequest, SubagentSessionKey } from "@tyrum/schemas";
import { readRecordString } from "../../util/coerce.js";
import {
  applyDeterministicContextCompactionAndToolPruning,
  type ContextPruningConfig,
} from "./context-pruning.js";
import type { ExecutionProfile } from "../execution-profiles.js";
import { buildAgentTurnKey } from "../turn-key.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { ExecutionEngine, StepExecutor } from "../../execution/engine.js";
import { LaneQueueInterruptError, type LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import type { SqlDb } from "../../../statestore/types.js";
import type { SessionLaneNodeAttachmentDal } from "../session-lane-node-attachment-dal.js";
import { WorkboardDal } from "../../workboard/dal.js";
import type { IdentityScopeDal } from "../../identity/scope.js";
import {
  loadTurnFailureFromRun,
  loadTurnResultFromRun,
  maybeResolvePausedRun,
} from "./turn-engine-bridge-run-state.js";
import { resolveAutomationMetadata } from "./automation-delivery.js";

export {
  loadTurnFailureFromRun,
  loadTurnResultFromRun,
  maybeResolvePausedRun,
} from "./turn-engine-bridge-run-state.js";

const TURN_ENGINE_MIN_BACKOFF_MS = 5;
const TURN_ENGINE_MAX_BACKOFF_MS = 250;

export type LaneQueueScope = { key: string; lane: string };

export type LaneQueueState = {
  tenant_id: string;
  scope: LaneQueueScope;
  signals: LaneQueueSignalDal;
  interruptError: LaneQueueInterruptError | undefined;
  cancelToolCalls: boolean;
  pendingInjectionTexts: string[];
};

type ToolExecutionApprovalPause = {
  kind: string;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
};

type TurnExecutionContext = {
  planId: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: string;
};

type ResolvedAgentTurnInput = {
  channel: string;
  thread_id: string;
  message: string;
  envelope?: NormalizedMessageEnvelopeT;
  metadata?: Record<string, unknown>;
};

export type TurnEngineBridgeDeps = {
  tenantId: string;
  agentKey: string;
  workspaceKey: string;
  identityScopeDal: IdentityScopeDal;
  executionEngine: ExecutionEngine;
  executionWorkerId: string;
  turnEngineWaitMs: number;
  approvalPollMs: number;
  db: SqlDb;
  approvalDal: ApprovalDal;
  sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
  resolveExecutionProfile: (input: {
    laneQueueScope?: LaneQueueScope;
    metadata?: Record<string, unknown>;
  }) => Promise<{ profile: ExecutionProfile }>;
  turnDirect: (
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ) => Promise<AgentTurnResponseT>;
  resolveAgentTurnInput: (input: AgentTurnRequestT) => ResolvedAgentTurnInput;
  resolveLaneQueueScope: (
    metadata: Record<string, unknown> | undefined,
  ) => LaneQueueScope | undefined;
  resolveTurnRequestId: (input: AgentTurnRequestT) => string;
  isToolExecutionApprovalRequiredError: (
    err: unknown,
  ) => err is { pause: ToolExecutionApprovalPause };
};

export function prepareLaneQueueStep(
  laneQueue: LaneQueueState | undefined,
  messages: Array<ModelMessage>,
  contextPruning?: ContextPruningConfig,
): { messages: Array<ModelMessage> } {
  let preparedMessages = messages;
  if (laneQueue) {
    if (laneQueue.interruptError) throw laneQueue.interruptError;

    const injectionTexts = laneQueue.pendingInjectionTexts.splice(
      0,
      laneQueue.pendingInjectionTexts.length,
    );
    laneQueue.cancelToolCalls = false;
    if (injectionTexts.length > 0) {
      preparedMessages = [
        ...preparedMessages,
        ...injectionTexts.map((text) => ({
          role: "user" as const,
          content: [{ type: "text" as const, text }],
        })),
      ];
    }
  }

  return {
    messages: applyDeterministicContextCompactionAndToolPruning(preparedMessages, contextPruning),
  };
}

export async function turnViaExecutionEngine(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): Promise<AgentTurnResponseT> {
  const resolvedInput = deps.resolveAgentTurnInput(input);
  const tenantKey = input.tenant_key?.trim();
  const agentKey = input.agent_key?.trim() || deps.agentKey;
  const workspaceKey = input.workspace_key?.trim() || deps.workspaceKey;
  const containerKind: NormalizedContainerKind =
    input.container_kind ?? resolvedInput.envelope?.container.kind ?? "channel";
  const defaultKey = buildAgentTurnKey({
    agentId: agentKey,
    workspaceId: workspaceKey,
    channel: resolvedInput.channel,
    containerKind,
    threadId: resolvedInput.thread_id,
    deliveryAccount: resolvedInput.envelope?.delivery.account,
  });
  const laneQueueScope = deps.resolveLaneQueueScope(resolvedInput.metadata);
  const automation = resolveAutomationMetadata(resolvedInput.metadata);
  const canOverride =
    laneQueueScope &&
    laneQueueScope.lane === "subagent" &&
    laneQueueScope.key.startsWith(`agent:${agentKey}:subagent:`) &&
    SubagentSessionKey.safeParse(laneQueueScope.key).success;
  const key = canOverride ? laneQueueScope.key : defaultKey;
  const lane = canOverride ? "subagent" : "main";
  const planId = `agent-turn-${agentKey}-${randomUUID()}`;
  const requestId = deps.resolveTurnRequestId(input);

  if (lane === "main") {
    try {
      const scopeIds = await deps.identityScopeDal.resolveScopeIds({
        ...(tenantKey ? { tenantKey } : {}),
        agentKey,
        workspaceKey,
      });
      const workScope: WorkScope = {
        tenant_id: scopeIds.tenantId,
        agent_id: scopeIds.agentId,
        workspace_id: scopeIds.workspaceId,
      };
      if (!automation) {
        await new WorkboardDal(deps.db).upsertScopeActivity({
          scope: workScope,
          last_active_session_key: key,
          updated_at_ms: Date.now(),
        });
      }
      await deps.sessionLaneNodeAttachmentDal.upsert({
        tenantId: workScope.tenant_id,
        key,
        lane,
        sourceClientDeviceId: readRecordString(resolvedInput.metadata, "source_client_device_id"),
        attachedNodeId: readRecordString(resolvedInput.metadata, "attached_node_id") ?? null,
        updatedAtMs: Date.now(),
      });
    } catch {
      // Intentional: ignore best-effort activity tracking failures.
    }
  }

  const executionProfile = await deps.resolveExecutionProfile({
    laneQueueScope,
    metadata: resolvedInput.metadata,
  });

  const stepArgs: Record<string, unknown> = {
    channel: resolvedInput.channel,
    thread_id: resolvedInput.thread_id,
    container_kind: containerKind,
    message: input.message,
    envelope: resolvedInput.envelope,
    ...(tenantKey ? { tenant_key: tenantKey } : {}),
    agent_key: agentKey,
    workspace_key: workspaceKey,
  };
  if (input.intake_mode) {
    stepArgs["intake_mode"] = input.intake_mode;
  }
  stepArgs["metadata"] = {
    ...(input.metadata as Record<string, unknown>),
    work_session_key: key,
    work_lane: lane,
  };

  const { runId } = await deps.executionEngine.enqueuePlan({
    tenantId: deps.tenantId,
    key,
    lane,
    workspaceKey,
    planId,
    requestId,
    budgets: executionProfile.profile.budgets,
    steps: [{ type: "Decide", args: stepArgs }],
  });

  // Ensure concurrent turns don't share a lease owner (lane leases are re-entrant for the same owner).
  const workerId = `${deps.executionWorkerId}-${runId}`;

  const startMs = Date.now();
  const deadlineMs = startMs + deps.turnEngineWaitMs;
  let laneQueueInterrupted = false;
  let laneQueueInterruptReason: string | undefined;

  const executor: StepExecutor = {
    execute: async (action, stepPlanId, stepIndex, timeoutMs, _context) => {
      if (action.type !== "Decide") {
        return { success: false, error: `unsupported action type: ${action.type}` };
      }

      const parsed = AgentTurnRequest.safeParse(action.args ?? {});
      if (!parsed.success) {
        return { success: false, error: `invalid agent turn request: ${parsed.error.message}` };
      }

      const remainingMs = Math.max(1, deadlineMs - Date.now());
      const normalizedTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : remainingMs;
      const requestedTimeoutMs = Math.max(1, Math.floor(normalizedTimeoutMs));
      const effectiveTimeoutMs = Math.min(requestedTimeoutMs, remainingMs);

      const stepRow = await deps.db.get<{
        step_id: string;
        approval_id: string | null;
      }>(
        `SELECT step_id, approval_id
           FROM execution_steps
           WHERE run_id = ? AND step_index = ?`,
        [runId, stepIndex],
      );
      if (!stepRow) {
        return {
          success: false,
          error: `execution step ${String(stepIndex)} not found for run ${runId}`,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
      try {
        const response = await deps.turnDirect(parsed.data, {
          abortSignal: controller.signal,
          timeoutMs: effectiveTimeoutMs,
          execution: {
            planId: stepPlanId,
            runId,
            stepIndex,
            stepId: stepRow.step_id,
            stepApprovalId: stepRow.approval_id ?? undefined,
          },
        });
        return { success: true, result: response };
      } catch (err) {
        if (deps.isToolExecutionApprovalRequiredError(err)) {
          return { success: true, pause: err.pause };
        }
        if (controller.signal.aborted) {
          return { success: false, error: `timed out after ${String(effectiveTimeoutMs)}ms` };
        }
        if (err instanceof LaneQueueInterruptError) {
          laneQueueInterrupted = true;
          laneQueueInterruptReason = err.message;
          await deps.executionEngine.cancelRun(runId, err.message);
          return { success: false, error: err.message };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      } finally {
        clearTimeout(timer);
      }
    },
  };

  type RunStatusRow = {
    status: string;
    paused_reason: string | null;
    paused_detail: string | null;
  };

  const resolveIfTerminal = async (row: RunStatusRow): Promise<AgentTurnResponseT | undefined> => {
    if (row.status === "succeeded") {
      const persisted = await loadTurnResultFromRun(deps, runId);
      if (persisted) {
        return persisted;
      }
      throw new Error("execution engine turn completed without a result payload");
    }

    if (row.status === "failed") {
      const failure = await loadTurnFailureFromRun(deps, runId);
      const reason =
        failure ?? row.paused_detail ?? row.paused_reason ?? `execution run ${row.status}`;
      throw new Error(reason);
    }

    if (row.status === "cancelled") {
      if (laneQueueInterrupted) {
        throw new LaneQueueInterruptError(laneQueueInterruptReason);
      }
      const failure = await loadTurnFailureFromRun(deps, runId);
      const reason =
        row.paused_detail ?? row.paused_reason ?? failure ?? `execution run ${row.status}`;
      throw new Error(reason);
    }

    if (row.status === "paused") {
      return undefined;
    }

    return undefined;
  };

  let backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;

  while (Date.now() < deadlineMs) {
    const run = await deps.db.get<RunStatusRow>(
      `SELECT status, paused_reason, paused_detail
         FROM execution_runs
         WHERE run_id = ?`,
      [runId],
    );
    if (!run) {
      throw new Error(`execution run '${runId}' not found`);
    }

    if (run.status === "paused") {
      const resolvedPause = await maybeResolvePausedRun(deps, runId);
      if (!resolvedPause) {
        const remainingMs = Math.max(1, deadlineMs - Date.now());
        const sleepMs = Math.min(deps.approvalPollMs, remainingMs);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      } else {
        backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
      }
      continue;
    }

    const resolved = await resolveIfTerminal(run);
    if (resolved) {
      return resolved;
    }

    const didWork = await deps.executionEngine.workerTick({
      workerId,
      executor,
      runId,
    });

    if (!didWork) {
      const remainingMs = Math.max(1, deadlineMs - Date.now());
      const sleepMs = Math.min(backoffMs, remainingMs);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      backoffMs = Math.min(TURN_ENGINE_MAX_BACKOFF_MS, backoffMs * 2);
    } else {
      backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
    }
  }

  // Avoid timing out when the run completed during the final tick but the
  // polling loop didn't get another iteration before the deadline elapsed.
  const completed = await deps.db.get<RunStatusRow>(
    `SELECT status, paused_reason, paused_detail
       FROM execution_runs
       WHERE run_id = ?`,
    [runId],
  );
  if (!completed) {
    throw new Error(`execution run '${runId}' not found`);
  }

  const resolved = await resolveIfTerminal(completed);
  if (resolved) {
    return resolved;
  }

  const elapsed = Math.max(0, Date.now() - startMs);
  const timeoutMessage = `execution run '${runId}' did not complete within ${String(elapsed)}ms`;

  const cancelOutcome = await deps.executionEngine.cancelRun(runId, timeoutMessage);

  // Best-effort: avoid leaving our lane/workspace leases behind when we give up waiting.
  // (Leases held by other workers expire and are cleaned up via the normal TTL/takeover flow.)
  try {
    const scope = await deps.db.get<{ tenant_id: string; workspace_id: string }>(
      `SELECT tenant_id, workspace_id
         FROM execution_runs
         WHERE run_id = ?`,
      [runId],
    );
    if (scope) {
      await deps.db.run(
        `DELETE FROM lane_leases
           WHERE tenant_id = ? AND key = ? AND lane = ? AND lease_owner = ?`,
        [scope.tenant_id, key, lane, workerId],
      );
      await deps.db.run(
        `DELETE FROM workspace_leases
           WHERE tenant_id = ? AND workspace_id = ? AND lease_owner = ?`,
        [scope.tenant_id, scope.workspace_id, workerId],
      );
    }
  } catch {
    // Intentional: ignore best-effort cleanup failures.
  }

  if (cancelOutcome === "already_terminal") {
    const latest = await deps.db.get<RunStatusRow>(
      `SELECT status, paused_reason, paused_detail
         FROM execution_runs
         WHERE run_id = ?`,
      [runId],
    );
    if (latest) {
      const terminal = await resolveIfTerminal(latest);
      if (terminal) {
        return terminal;
      }
    }
  }

  throw new Error(timeoutMessage);
}
