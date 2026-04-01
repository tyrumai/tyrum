import type { ModelMessage } from "ai";
import type { streamText } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  ApprovalKind as ApprovalKindT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import {
  applyDeterministicContextCompactionAndToolPruning,
  type ContextPruningConfig,
} from "./context-pruning.js";
import type { ExecutionProfile } from "../execution-profiles.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { ExecutionEngine } from "../../execution/engine.js";
import {
  ConversationQueueInterruptError,
  type ConversationQueueSignalDal,
} from "../../conversation-queue/queue-signal-dal.js";
import type { SqlDb } from "../../../statestore/types.js";
import type { ConversationNodeAttachmentDal } from "../conversation-node-attachment-dal.js";
import type { IdentityScopeDal } from "../../identity/scope.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import { maybeResolvePausedTurn } from "./turn-engine-bridge-turn-state.js";
import {
  cleanupTurnExecutionTimeout,
  createTurnExecutor,
  prepareTurnExecution,
  resolveIfTerminal,
  type TurnStatusRow,
} from "./turn-engine-bridge-execution.js";

export {
  loadTurnFailure,
  loadTurnResult,
  maybeResolvePausedTurn,
} from "./turn-engine-bridge-turn-state.js";
export { turnViaExecutionEngineStream } from "./turn-engine-bridge-stream.js";

const TURN_ENGINE_MIN_BACKOFF_MS = 5;
const TURN_ENGINE_MAX_BACKOFF_MS = 250;

export type ConversationQueueTarget = { key: string };

export type ConversationQueueState = {
  tenant_id: string;
  target: ConversationQueueTarget;
  signals: ConversationQueueSignalDal;
  interruptError: ConversationQueueInterruptError | undefined;
  cancelToolCalls: boolean;
  pendingInjectionTexts: string[];
};

type ToolExecutionApprovalPause = {
  kind: ApprovalKindT;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
};

export type TurnExecutionContext = {
  planId: string;
  turnId: string;
  stepIndex?: number;
  stepId?: string;
  stepApprovalId?: string;
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
  conversationNodeAttachmentDal: ConversationNodeAttachmentDal;
  redactText: (text: string) => string;
  redactUnknown: <T>(value: T) => T;
  resolveExecutionProfile: (input: {
    queueTarget?: ConversationQueueTarget;
    metadata?: Record<string, unknown>;
  }) => Promise<{ profile: ExecutionProfile }>;
  turnDirect: (
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ) => Promise<AgentTurnResponseT>;
  resolveAgentTurnInput: (input: AgentTurnRequestT) => ResolvedAgentTurnInput;
  resolveConversationQueueTarget: (
    metadata: Record<string, unknown> | undefined,
  ) => ConversationQueueTarget | undefined;
  resolveTurnRequestId: (input: AgentTurnRequestT) => string;
  isToolExecutionApprovalRequiredError: (
    err: unknown,
  ) => err is { pause: ToolExecutionApprovalPause };
};

export type TurnEngineStreamBridgeDeps = TurnEngineBridgeDeps & {
  turnStream: (
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ) => Promise<{
    streamResult: ReturnType<typeof streamText>;
    finalize: () => Promise<AgentTurnResponseT>;
  }>;
};

export function prepareConversationQueueStep(
  queueState: ConversationQueueState | undefined,
  messages: Array<ModelMessage>,
  contextPruning?: ContextPruningConfig,
): { messages: Array<ModelMessage> } {
  let preparedMessages = messages;
  if (queueState) {
    if (queueState.interruptError) throw queueState.interruptError;

    const injectionTexts = queueState.pendingInjectionTexts.splice(
      0,
      queueState.pendingInjectionTexts.length,
    );
    queueState.cancelToolCalls = false;
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
  const prepared = await prepareTurnExecution(deps, input);
  const interruptState = createTurnExecutor(deps, {
    deadlineMs: prepared.deadlineMs,
    executeTurn: deps.turnDirect,
    turnId: prepared.turnId,
  });

  let backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;

  while (Date.now() < prepared.deadlineMs) {
    const run = await deps.db.get<TurnStatusRow>(
      `SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail
         FROM turns
         WHERE turn_id = ?`,
      [prepared.turnId],
    );
    if (!run) {
      throw new Error(`execution turn '${prepared.turnId}' not found`);
    }

    if (run.status === "paused") {
      const resolvedPause = await maybeResolvePausedTurn(deps, prepared.turnId);
      if (!resolvedPause) {
        const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
        const sleepMs = Math.min(deps.approvalPollMs, remainingMs);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      } else {
        backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
      }
      continue;
    }

    const resolved = await resolveIfTerminal(
      deps,
      {
        getConversationQueueInterrupted: interruptState.getConversationQueueInterrupted,
        getConversationQueueInterruptReason: interruptState.getConversationQueueInterruptReason,
        turnId: prepared.turnId,
      },
      run,
    );
    if (resolved) {
      return resolved;
    }

    const didWork = await deps.executionEngine.workerTick({
      workerId: prepared.workerId,
      executor: interruptState.executor,
      turnId: prepared.turnId,
    });

    if (!didWork) {
      const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
      const sleepMs = Math.min(backoffMs, remainingMs);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      backoffMs = Math.min(TURN_ENGINE_MAX_BACKOFF_MS, backoffMs * 2);
    } else {
      backoffMs = TURN_ENGINE_MIN_BACKOFF_MS;
    }
  }

  const completed = await deps.db.get<TurnStatusRow>(
    `SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail
       FROM turns
       WHERE turn_id = ?`,
    [prepared.turnId],
  );
  if (!completed) {
    throw new Error(`execution turn '${prepared.turnId}' not found`);
  }

  const resolved = await resolveIfTerminal(
    deps,
    {
      getConversationQueueInterrupted: interruptState.getConversationQueueInterrupted,
      getConversationQueueInterruptReason: interruptState.getConversationQueueInterruptReason,
      turnId: prepared.turnId,
    },
    completed,
  );
  if (resolved) {
    return resolved;
  }

  const elapsed = Math.max(0, Date.now() - prepared.startMs);
  const timeoutMessage = `execution turn '${prepared.turnId}' did not complete within ${String(elapsed)}ms`;
  const cancelOutcome = await deps.executionEngine.cancelTurn(prepared.turnId, timeoutMessage);
  await cleanupTurnExecutionTimeout(deps, prepared);

  if (cancelOutcome === "already_terminal") {
    const latest = await deps.db.get<TurnStatusRow>(
      `SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail
         FROM turns
         WHERE turn_id = ?`,
      [prepared.turnId],
    );
    if (latest) {
      const terminal = await resolveIfTerminal(
        deps,
        {
          getConversationQueueInterrupted: interruptState.getConversationQueueInterrupted,
          getConversationQueueInterruptReason: interruptState.getConversationQueueInterruptReason,
          turnId: prepared.turnId,
        },
        latest,
      );
      if (terminal) {
        return terminal;
      }
    }
  }

  throw new Error(timeoutMessage);
}
