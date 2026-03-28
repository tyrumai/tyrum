import { stepCountIs, streamText, type ModelMessage } from "ai";
import type { ConversationState, TyrumUIMessage } from "@tyrum/contracts";
import { stripEmbeddedConversationContext } from "./turn-direct-support.js";
import { createStaticLanguageModelV3 } from "./turn-helpers.js";
import { applyDeterministicContextCompactionAndToolPruning } from "./context-pruning.js";
import { buildPromptVisibleMessages } from "./conversation-context-state.js";
import { conversationMessagesToModelMessages } from "../../ai-sdk/message-utils.js";
import {
  createAttachmentDownloadFunction,
  rewriteHistoryMessagesForHelperMode,
} from "./attachment-analysis.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";

type ActiveConversation = {
  tenant_id: string;
  conversation_id: string;
  messages: readonly TyrumUIMessage[];
  context_state: ConversationState | null;
};

type UserContent = Parameters<typeof stripEmbeddedConversationContext>[0];
type ContextPruningConfig = Parameters<typeof applyDeterministicContextCompactionAndToolPruning>[1];

export function pruneDirectPromptMessages(
  messages: ModelMessage[],
  contextPruning: ContextPruningConfig,
): ModelMessage[] {
  return applyDeterministicContextCompactionAndToolPruning(messages, contextPruning);
}

export function createDirectTurnDownloadFunction(deps: TurnDirectDeps) {
  return createAttachmentDownloadFunction({
    fetchImpl: deps.prepareTurnDeps.fetchImpl,
    artifactStore: deps.opts.container.artifactStore,
    maxBytes: deps.opts.container.deploymentConfig.attachments.maxAnalysisBytes,
  });
}

export async function reloadActiveConversation<T extends ActiveConversation>(
  deps: TurnDirectDeps,
  conversation: T,
): Promise<T> {
  return ((await deps.conversationDal.getById({
    tenantId: conversation.tenant_id,
    conversationId: conversation.conversation_id,
  })) ?? conversation) as T;
}

export async function buildDirectPromptMessages(input: {
  activeConversation: ActiveConversation;
  contextPruning: ContextPruningConfig;
  rewriteHistoryAttachmentsForModel: boolean;
  userContent: UserContent;
}): Promise<ModelMessage[]> {
  const promptUserContent = stripEmbeddedConversationContext(
    input.userContent,
    input.activeConversation.context_state,
  );
  const promptVisibleMessages = buildPromptVisibleMessages(
    input.activeConversation.messages,
    input.activeConversation.context_state,
  );
  const historyMessages = input.rewriteHistoryAttachmentsForModel
    ? rewriteHistoryMessagesForHelperMode(promptVisibleMessages)
    : promptVisibleMessages;

  return pruneDirectPromptMessages(
    [
      ...(await conversationMessagesToModelMessages(historyMessages)),
      { role: "user" as const, content: promptUserContent },
    ],
    input.contextPruning,
  );
}

export function buildDelegationStreamResult(reply: string): ReturnType<typeof streamText> {
  return streamText({
    model: createStaticLanguageModelV3(reply),
    system: "",
    messages: [{ role: "user" as const, content: [{ type: "text", text: "" }] }],
    stopWhen: [stepCountIs(1)],
  });
}
