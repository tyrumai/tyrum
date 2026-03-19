import { stepCountIs, streamText, type ModelMessage } from "ai";
import type { SessionContextState, TyrumUIMessage } from "@tyrum/contracts";
import { stripEmbeddedSessionContext } from "./turn-direct-support.js";
import { createStaticLanguageModelV3 } from "./turn-helpers.js";
import { applyDeterministicContextCompactionAndToolPruning } from "./context-pruning.js";
import { buildPromptVisibleMessages } from "./session-context-state.js";
import { sessionMessagesToModelMessages } from "../../ai-sdk/message-utils.js";
import {
  createAttachmentDownloadFunction,
  rewriteHistoryMessagesForHelperMode,
} from "./attachment-analysis.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";

type ActiveSession = {
  tenant_id: string;
  session_id: string;
  messages: readonly TyrumUIMessage[];
  context_state: SessionContextState | null;
};

type UserContent = Parameters<typeof stripEmbeddedSessionContext>[0];
type ContextPruningConfig = Parameters<typeof applyDeterministicContextCompactionAndToolPruning>[1];

export function createDirectTurnDownloadFunction(deps: TurnDirectDeps) {
  return createAttachmentDownloadFunction({
    fetchImpl: deps.prepareTurnDeps.fetchImpl,
    artifactStore: deps.opts.container.artifactStore,
    maxBytes: deps.opts.container.deploymentConfig.attachments.maxAnalysisBytes,
  });
}

export async function reloadActiveSession<T extends ActiveSession>(
  deps: TurnDirectDeps,
  session: T,
): Promise<T> {
  return ((await deps.sessionDal.getById({
    tenantId: session.tenant_id,
    sessionId: session.session_id,
  })) ?? session) as T;
}

export async function buildDirectPromptMessages(input: {
  activeSession: ActiveSession;
  contextPruning: ContextPruningConfig;
  rewriteHistoryAttachmentsForModel: boolean;
  userContent: UserContent;
}): Promise<ModelMessage[]> {
  const promptUserContent = stripEmbeddedSessionContext(
    input.userContent,
    input.activeSession.context_state,
  );
  const promptVisibleMessages = buildPromptVisibleMessages(
    input.activeSession.messages,
    input.activeSession.context_state,
  );
  const historyMessages = input.rewriteHistoryAttachmentsForModel
    ? rewriteHistoryMessagesForHelperMode(promptVisibleMessages)
    : promptVisibleMessages;

  return applyDeterministicContextCompactionAndToolPruning(
    [
      ...(await sessionMessagesToModelMessages(historyMessages)),
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
