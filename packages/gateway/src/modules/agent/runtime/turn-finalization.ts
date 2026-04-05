import { generateText, type LanguageModel } from "ai";
import type { AgentTurnResponse as AgentTurnResponseT, TyrumUIMessage } from "@tyrum/contracts";
import { AgentTurnResponse } from "@tyrum/contracts";
import type { GatewayContainer } from "../../../container.js";
import type { ModelMessage } from "ai";
import type { ArtifactRecordInsertInput } from "../../artifact/dal.js";
import { decideCrossTurnLoopWarning, LOOP_WARNING_PREFIX } from "../loop-detection.js";
import type { ConversationDal, ConversationRow } from "../conversation-dal.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { AgentContextReport, AgentLoadedContext } from "./types.js";
import {
  applyFinalAssistantReply,
  createTextChatMessage,
  modelMessagesToChatMessages,
} from "../../ai-sdk/message-utils.js";
import {
  buildUserTurnMessage,
  collectArtifactRefsFromMessages,
  createArtifactFilePart,
  materializeStoredMessageFiles,
} from "../../ai-sdk/attachment-parts.js";
import { normalizeConversationTitle } from "../conversation-dal-helpers.js";
import { appendWithoutDuplicateOverlap } from "../../ai-sdk/message-overlap.js";
import {
  persistTurnMessages,
  selectPersistedTurnMessages,
} from "./turn-finalization-persisted-messages.js";

type FinalizeContainer = Pick<
  GatewayContainer,
  "artifactStore" | "contextReportDal" | "db" | "logger"
>;

function withTurnMetadata(
  message: TyrumUIMessage,
  input: {
    turnId?: string;
    createdAt?: string;
  },
): TyrumUIMessage {
  const nextMetadata =
    input.turnId || input.createdAt
      ? {
          ...message.metadata,
          ...(input.turnId ? { turn_id: input.turnId } : {}),
          ...(input.createdAt ? { created_at: input.createdAt } : {}),
        }
      : message.metadata;
  return nextMetadata ? { ...message, metadata: nextMetadata } : message;
}

function withTurnMetadataForMessages(
  messages: readonly TyrumUIMessage[],
  input: {
    turnId?: string;
    createdAt?: string;
  },
): TyrumUIMessage[] {
  return messages.map((message) => withTurnMetadata(message, input));
}

function isAssistantTextMessage(message: TyrumUIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part: TyrumUIMessage["parts"][number]) =>
        part.type === "text" && typeof part["text"] === "string",
    )
  );
}

function textFromChatMessage(message: TyrumUIMessage): string {
  return message.parts
    .flatMap((part: TyrumUIMessage["parts"][number]) =>
      part.type === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
    )
    .join("\n\n")
    .trim();
}

async function hasPersistedTurn(input: {
  container: FinalizeContainer;
  conversation: ConversationRow;
  turnId: string;
}): Promise<boolean> {
  const existingTurn = await input.container.db.get<{ turn_id: string }>(
    `SELECT turn_id
       FROM turns
      WHERE tenant_id = ? AND turn_id = ?
      LIMIT 1`,
    [input.conversation.tenant_id, input.turnId],
  );
  return existingTurn !== undefined;
}

const CROSS_TURN_LOOP_WARNING_TEXT =
  `${LOOP_WARNING_PREFIX} I may be repeating myself. If this isn't progressing, tell me what to change ` +
  "(goal/constraints/example output) and I'll take a different approach.";

function applyCrossTurnLoopWarning(input: {
  container: FinalizeContainer;
  ctx: AgentLoadedContext;
  conversation: ConversationRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
}): string {
  const crossTurnCfg = input.ctx.config.conversations.loop_detection.cross_turn;
  if (!crossTurnCfg.enabled || input.reply.includes(LOOP_WARNING_PREFIX)) {
    return input.reply;
  }

  const previousAssistantMessages = input.conversation.messages
    .filter(isAssistantTextMessage)
    .map(textFromChatMessage)
    .filter((message) => message.length > 0);
  const decision = decideCrossTurnLoopWarning({
    previousAssistantMessages,
    reply: input.reply,
    windowAssistantMessages: crossTurnCfg.window_assistant_messages,
    similarityThreshold: crossTurnCfg.similarity_threshold,
    minChars: crossTurnCfg.min_chars,
    cooldownAssistantMessages: crossTurnCfg.cooldown_assistant_messages,
  });
  if (!decision.warn) return input.reply;

  input.container.logger.info("agents.loop.cross_turn_warned", {
    conversation_id: input.conversation.conversation_id,
    channel: input.resolved.channel,
    thread_id: input.resolved.thread_id,
    similarity: decision.similarity,
    matched_index: decision.matchedIndex,
  });
  return `${input.reply.trimEnd()}\n\n${CROSS_TURN_LOOP_WARNING_TEXT}`;
}

async function persistContextReport(input: {
  container: FinalizeContainer;
  conversation: ConversationRow;
  resolved: ResolvedAgentTurnInput;
  contextReport: AgentContextReport;
}): Promise<void> {
  try {
    await input.container.contextReportDal.insert({
      tenantId: input.conversation.tenant_id,
      contextReportId: input.contextReport.context_report_id,
      conversationId: input.conversation.conversation_id,
      channel: input.resolved.channel,
      threadId: input.resolved.thread_id,
      agentId: input.contextReport.agent_id,
      workspaceId: input.contextReport.workspace_id,
      report: input.contextReport,
      createdAtIso: input.contextReport.generated_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("context_report.persist_failed", {
      context_report_id: input.contextReport.context_report_id,
      conversation_id: input.conversation.conversation_id,
      error: message,
    });
  }
}

async function maybeGenerateConversationTitle(input: {
  container: FinalizeContainer;
  conversationDal: ConversationDal;
  conversation: ConversationRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  model: LanguageModel;
}): Promise<void> {
  if (input.conversation.title.trim().length > 0) return;

  try {
    const result = await generateText({
      model: input.model,
      system:
        "Write a concise conversation title. Return plain text only. " +
        "Use 3 to 8 words, no quotes, no markdown, no trailing punctuation. " +
        "Avoid generic titles such as Need help, Question, Chat, Task, or New conversation.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `User message:\n${input.resolved.message}\n\n` +
                `Assistant reply:\n${input.reply}\n\n` +
                "Title:",
            },
          ],
        },
      ],
    });
    const title = normalizeConversationTitle(result.text ?? "");
    if (!title) return;
    await input.conversationDal.setTitleIfBlank({
      tenantId: input.conversation.tenant_id,
      conversationId: input.conversation.conversation_id,
      title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("agents.conversation_title_generation_failed", {
      conversation_id: input.conversation.conversation_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      error: message,
    });
  }
}

export async function finalizeTurn(input: {
  container: FinalizeContainer;
  conversationDal: ConversationDal;
  ctx: AgentLoadedContext;
  conversation: ConversationRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  turn_id?: string;
  model: LanguageModel;
  usedTools: ReadonlySet<string>;
  memoryWritten: boolean;
  contextReport: AgentContextReport;
  turnKind?: "normal" | "skip";
  responseMessages?: readonly ModelMessage[];
}): Promise<AgentTurnResponseT> {
  const nowIso = new Date().toISOString();
  const finalizedReply = applyCrossTurnLoopWarning(input);
  const memoryWritten = input.turnKind !== "skip" && input.memoryWritten;
  let responseAttachments: AgentTurnResponseT["attachments"] = [];
  const artifactRecordScope = {
    tenantId: input.conversation.tenant_id,
    workspaceId: input.conversation.workspace_id,
    agentId: input.conversation.agent_id,
  };

  await persistContextReport(input);
  let updatedConversation: ConversationRow;
  if (input.responseMessages) {
    const currentUserMessage = withTurnMetadata(
      buildUserTurnMessage({
        parts: input.resolved.parts,
        fallbackText: input.resolved.message,
      }),
      {
        turnId: input.turn_id,
        createdAt: nowIso,
      },
    );
    const baseMessages = appendWithoutDuplicateOverlap(input.conversation.messages, [
      currentUserMessage,
    ]);
    const appendedMessages = withTurnMetadataForMessages(
      applyFinalAssistantReply(modelMessagesToChatMessages(input.responseMessages), finalizedReply),
      {
        turnId: input.turn_id,
        createdAt: nowIso,
      },
    );
    const assistantArtifacts = collectArtifactRefsFromMessages(appendedMessages);
    responseAttachments = assistantArtifacts;
    const assistantAttachmentParts = assistantArtifacts
      .map((artifact) => createArtifactFilePart(artifact))
      .filter((part): part is NonNullable<typeof part> => part !== undefined);
    const appendedWithAttachments =
      assistantAttachmentParts.length > 0
        ? [
            ...appendedMessages,
            withTurnMetadata(
              {
                id: `assistant-attachments-${nowIso}`,
                role: "assistant" as const,
                parts: assistantAttachmentParts,
              },
              {
                turnId: input.turn_id,
                createdAt: nowIso,
              },
            ),
          ]
        : appendedMessages;
    const mergedMessages = appendWithoutDuplicateOverlap(baseMessages, appendedWithAttachments);
    const artifactRecords: ArtifactRecordInsertInput[] = [];
    await input.conversationDal.replaceMessages({
      tenantId: input.conversation.tenant_id,
      conversationId: input.conversation.conversation_id,
      messages: await materializeStoredMessageFiles(
        mergedMessages,
        input.container.artifactStore,
        undefined,
        artifactRecordScope,
        artifactRecords,
      ),
      artifactRecords,
      updatedAt: nowIso,
    });
    updatedConversation =
      (await input.conversationDal.getById({
        tenantId: input.conversation.tenant_id,
        conversationId: input.conversation.conversation_id,
      })) ?? input.conversation;
  } else {
    const artifactRecords: ArtifactRecordInsertInput[] = [];
    const currentUserMessage = withTurnMetadata(
      buildUserTurnMessage({
        parts: input.resolved.parts,
        fallbackText: input.resolved.message,
      }),
      {
        turnId: input.turn_id,
        createdAt: nowIso,
      },
    );
    const baseMessages = appendWithoutDuplicateOverlap(input.conversation.messages, [
      currentUserMessage,
    ]);
    const nextMessages = await materializeStoredMessageFiles(
      [
        ...baseMessages,
        withTurnMetadata(createTextChatMessage({ role: "assistant", text: finalizedReply }), {
          turnId: input.turn_id,
          createdAt: nowIso,
        }),
      ],
      input.container.artifactStore,
      undefined,
      artifactRecordScope,
      artifactRecords,
    );
    await input.conversationDal.replaceMessages({
      tenantId: input.conversation.tenant_id,
      conversationId: input.conversation.conversation_id,
      messages: nextMessages,
      artifactRecords,
      updatedAt: nowIso,
    });
    updatedConversation =
      (await input.conversationDal.getById({
        tenantId: input.conversation.tenant_id,
        conversationId: input.conversation.conversation_id,
      })) ?? input.conversation;
  }
  if (
    input.turn_id &&
    (await hasPersistedTurn({
      container: input.container,
      conversation: updatedConversation,
      turnId: input.turn_id,
    }))
  ) {
    const persistedTurnMessages = selectPersistedTurnMessages({
      messages: updatedConversation.messages,
      turnId: input.turn_id,
      fallbackCreatedAt: nowIso,
    });
    await persistTurnMessages({
      db: input.container.db,
      conversation: updatedConversation,
      turnId: input.turn_id,
      messages: persistedTurnMessages,
      fallbackCreatedAt: nowIso,
    });
  }
  await maybeGenerateConversationTitle({
    container: input.container,
    conversationDal: input.conversationDal,
    conversation: updatedConversation,
    resolved: input.resolved,
    reply: finalizedReply,
    model: input.model,
  });

  return AgentTurnResponse.parse({
    reply: finalizedReply,
    turn_id: input.turn_id,
    conversation_id: input.conversation.conversation_id,
    conversation_key: input.conversation.conversation_key,
    attachments: responseAttachments,
    used_tools: Array.from(input.usedTools),
    memory_written: memoryWritten,
  });
}
