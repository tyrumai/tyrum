import { stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import {
  prepareConversationQueueStep as prepareConversationQueueStepBridge,
  type ConversationQueueState,
} from "./turn-engine-bridge.js";
import type { AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import type { ConversationDal, ConversationRow } from "../conversation-dal.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { ResolvedConversationModel } from "./conversation-model-resolution.js";
import { detectWithinTurnToolLoop } from "../loop-detection.js";
import { WITHIN_TURN_LOOP_STOP_REPLY } from "./runtime-constants.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import {
  compactConversationWithResolvedModel,
  type ConversationUsageSnapshot,
  shouldCompactConversationForUsage,
} from "./conversation-compaction-service.js";

export function makeEventfulAbortSignal(
  upstream: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!upstream) return undefined;
  const controller = new AbortController();

  const abortLater = () => {
    queueMicrotask(() => controller.abort());
  };

  upstream.addEventListener("abort", abortLater, { once: true });
  if (upstream.aborted) {
    abortLater();
  }

  return controller.signal;
}

export function createStopWhenWithWithinTurnLoopDetection(
  logger: { warn: (msg: string, fields?: Record<string, unknown>) => void },
  input: {
    stepLimit: number;
    withinTurnCfg: {
      enabled: boolean;
      consecutive_repeat_limit: number;
      cycle_repeat_limit: number;
    };
    conversationId: string;
    channel: string;
    threadId: string;
  },
): {
  stopWhen: Array<ReturnType<typeof stepCountIs>>;
  withinTurnLoop: { value: ReturnType<typeof detectWithinTurnToolLoop> | undefined };
} {
  const withinTurnLoop = {
    value: undefined as ReturnType<typeof detectWithinTurnToolLoop> | undefined,
  };
  const stopWhen = [stepCountIs(input.stepLimit)];

  if (input.withinTurnCfg.enabled) {
    stopWhen.push(({ steps }) => {
      if (withinTurnLoop.value) return true;
      const detected = detectWithinTurnToolLoop({
        steps,
        consecutiveRepeatLimit: input.withinTurnCfg.consecutive_repeat_limit,
        cycleRepeatLimit: input.withinTurnCfg.cycle_repeat_limit,
      });
      if (!detected) return false;
      withinTurnLoop.value = detected;
      logger.warn("agents.loop.within_turn_detected", {
        conversation_id: input.conversationId,
        channel: input.channel,
        thread_id: input.threadId,
        kind: detected.kind,
        tool_names: detected.toolNames,
      });
      return true;
    });
  }

  return { stopWhen, withinTurnLoop };
}

export function resolveTurnReply(
  rawReply: string,
  withinTurnLoop: ReturnType<typeof detectWithinTurnToolLoop> | undefined,
  opts?: { allowEmpty?: boolean },
): string {
  if (withinTurnLoop) {
    if (rawReply.trim().length === 0) return WITHIN_TURN_LOOP_STOP_REPLY;
    if (rawReply.includes(WITHIN_TURN_LOOP_STOP_REPLY)) return rawReply;
    return `${rawReply}\n\n${WITHIN_TURN_LOOP_STOP_REPLY}`;
  }
  if (rawReply.length > 0) return rawReply;
  if (opts?.allowEmpty) return "";
  return "No assistant response returned.";
}

export function prepareConversationQueueStep(
  queueState: ConversationQueueState | undefined,
  messages: Array<ModelMessage>,
  contextPruning: Parameters<typeof prepareConversationQueueStepBridge>[2],
): { messages: Array<ModelMessage> } {
  return prepareConversationQueueStepBridge(queueState, messages, contextPruning);
}

function systemMessageText(message: ModelMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (typeof part === "string") {
        return [part];
      }
      if (!part || typeof part !== "object") {
        return [];
      }
      const record = part as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n\n");
}

export function splitSystemMessagesForInstructions(input: {
  instructions?: string;
  messages: readonly ModelMessage[];
}): { instructions?: string; messages: ModelMessage[] } {
  const instructionParts =
    input.instructions && input.instructions.length > 0 ? [input.instructions] : [];
  const messages: ModelMessage[] = [];

  for (const message of input.messages) {
    if (message.role !== "system") {
      messages.push(message);
      continue;
    }

    const text = systemMessageText(message);
    if (text.length > 0) {
      instructionParts.push(text);
    }
  }

  return {
    instructions: instructionParts.length > 0 ? instructionParts.join("\n\n") : undefined,
    messages,
  };
}

export interface TurnDirectDeps {
  opts: AgentRuntimeOptions;
  prepareTurnDeps: PrepareTurnDeps;
  conversationDal: ConversationDal;
  approvalDal: ApprovalDal;
  agentId: string;
  workspaceId: string;
  maxSteps: number;
  approvalWaitMs: number;
  secretProvider?: SecretProvider;
}

export async function maybeAutoCompactConversation(input: {
  deps: TurnDirectDeps;
  tenantId: string;
  ctx: AgentLoadedContext;
  conversationId: string;
  model: LanguageModel;
  modelResolution: ResolvedConversationModel;
  usage: ConversationUsageSnapshot | undefined;
  currentTurnText?: string;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  channel?: string;
  threadId?: string;
}): Promise<void> {
  const persisted = await input.deps.conversationDal.getById({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });
  if (!persisted) {
    return;
  }

  if (
    !shouldCompactConversationForUsage({
      config: input.ctx.config,
      conversation: persisted,
      modelResolution: input.modelResolution,
      usage: input.usage,
      currentTurnText: input.currentTurnText,
      systemPrompt: input.systemPrompt,
    })
  ) {
    return;
  }

  await compactConversationWithResolvedModel({
    container: input.deps.opts.container,
    conversationDal: input.deps.conversationDal,
    ctx: input.ctx,
    conversation: persisted,
    model: input.model,
    abortSignal: input.abortSignal,
    timeoutMs: input.timeoutMs,
    logger: input.deps.opts.container.logger,
    prepareTurnDeps: input.deps.prepareTurnDeps,
    channel: input.channel,
    threadId: input.threadId,
  });
}

export async function compactForOverflow(input: {
  deps: TurnDirectDeps;
  ctx: AgentLoadedContext;
  conversation: ConversationRow;
  model: LanguageModel;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  channel?: string;
  threadId?: string;
}): Promise<void> {
  await compactConversationWithResolvedModel({
    container: input.deps.opts.container,
    conversationDal: input.deps.conversationDal,
    ctx: input.ctx,
    conversation: input.conversation,
    model: input.model,
    abortSignal: input.abortSignal,
    timeoutMs: input.timeoutMs,
    logger: input.deps.opts.container.logger,
    prepareTurnDeps: input.deps.prepareTurnDeps,
    channel: input.channel,
    threadId: input.threadId,
  });
}
