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
import type { PolicyService } from "@tyrum/runtime-policy";
import type { ApprovalDal } from "../../approval/dal.js";
import {
  ConversationQueueInterruptError,
  type ConversationQueueSignalDal,
} from "../../conversation-queue/queue-signal-dal.js";
import type { SqlDb } from "../../../statestore/types.js";
import type { ConversationNodeAttachmentDal } from "../conversation-node-attachment-dal.js";
import type { IdentityScopeDal } from "../../identity/scope.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { TurnController } from "./turn-controller.js";

export {
  loadTurnFailure,
  loadTurnResult,
  maybeResolvePausedTurn,
} from "./turn-engine-bridge-turn-state.js";

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
  turnController: TurnController;
  executionWorkerId: string;
  turnEngineWaitMs: number;
  approvalPollMs: number;
  db: SqlDb;
  policyService: PolicyService;
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
