import { generateText, type LanguageModel } from "ai";
import type { AgentTurnResponse as AgentTurnResponseT, TyrumUIMessage } from "@tyrum/contracts";
import { AgentTurnResponse } from "@tyrum/contracts";
import type { GatewayContainer } from "../../../container.js";
import type { ModelMessage } from "ai";
import { decideCrossTurnLoopWarning, LOOP_WARNING_PREFIX } from "../loop-detection.js";
import type { SessionDal, SessionRow } from "../session-dal.js";
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
import { normalizeSessionTitle } from "../session-dal-helpers.js";

type FinalizeContainer = Pick<
  GatewayContainer,
  "artifactStore" | "contextReportDal" | "db" | "logger"
>;

function messagesEqualIgnoringId(left: TyrumUIMessage, right: TyrumUIMessage): boolean {
  return left.role === right.role && JSON.stringify(left.parts) === JSON.stringify(right.parts);
}

function appendWithoutDuplicateOverlap(
  existing: readonly TyrumUIMessage[],
  appended: readonly TyrumUIMessage[],
): TyrumUIMessage[] {
  const maxOverlap = Math.min(existing.length, appended.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      const left = existing[existing.length - overlap + index];
      const right = appended[index];
      if (!left || !right || !messagesEqualIgnoringId(left, right)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return [...existing, ...appended.slice(overlap)];
    }
  }
  return [...existing, ...appended];
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

const CROSS_TURN_LOOP_WARNING_TEXT =
  `${LOOP_WARNING_PREFIX} I may be repeating myself. If this isn't progressing, tell me what to change ` +
  "(goal/constraints/example output) and I'll take a different approach.";

function applyCrossTurnLoopWarning(input: {
  container: FinalizeContainer;
  ctx: AgentLoadedContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
}): string {
  const crossTurnCfg = input.ctx.config.sessions.loop_detection.cross_turn;
  if (!crossTurnCfg.enabled || input.reply.includes(LOOP_WARNING_PREFIX)) {
    return input.reply;
  }

  const previousAssistantMessages = input.session.messages
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
    session_id: input.session.session_id,
    channel: input.resolved.channel,
    thread_id: input.resolved.thread_id,
    similarity: decision.similarity,
    matched_index: decision.matchedIndex,
  });
  return `${input.reply.trimEnd()}\n\n${CROSS_TURN_LOOP_WARNING_TEXT}`;
}

async function persistContextReport(input: {
  container: FinalizeContainer;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  contextReport: AgentContextReport;
}): Promise<void> {
  try {
    await input.container.contextReportDal.insert({
      tenantId: input.session.tenant_id,
      contextReportId: input.contextReport.context_report_id,
      sessionId: input.session.session_id,
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
      session_id: input.session.session_id,
      error: message,
    });
  }
}

async function maybeGenerateSessionTitle(input: {
  container: FinalizeContainer;
  sessionDal: SessionDal;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  model: LanguageModel;
}): Promise<void> {
  if (input.session.title.trim().length > 0) return;

  try {
    const result = await generateText({
      model: input.model,
      system:
        "Write a concise session title. Return plain text only. " +
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
    const title = normalizeSessionTitle(result.text ?? "");
    if (!title) return;
    await input.sessionDal.setTitleIfBlank({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("agents.session_title_generation_failed", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      error: message,
    });
  }
}

export async function finalizeTurn(input: {
  container: FinalizeContainer;
  sessionDal: SessionDal;
  ctx: AgentLoadedContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
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
    db: input.container.db,
    tenantId: input.session.tenant_id,
    workspaceId: input.session.workspace_id,
    agentId: input.session.agent_id,
  };

  await persistContextReport(input);
  let updatedSession: SessionRow;
  if (input.responseMessages) {
    const currentUserMessage = buildUserTurnMessage({
      parts: input.resolved.parts,
      fallbackText: input.resolved.message,
    });
    const appendedMessages = applyFinalAssistantReply(
      modelMessagesToChatMessages(input.responseMessages),
      finalizedReply,
    );
    const assistantArtifacts = collectArtifactRefsFromMessages(appendedMessages);
    responseAttachments = assistantArtifacts;
    const assistantAttachmentParts = assistantArtifacts
      .map((artifact) => createArtifactFilePart(artifact))
      .filter((part): part is NonNullable<typeof part> => part !== undefined);
    const nextMessages = await materializeStoredMessageFiles(
      [...input.session.messages, currentUserMessage],
      input.container.artifactStore,
      undefined,
      artifactRecordScope,
    );
    const appendedWithAttachments =
      assistantAttachmentParts.length > 0
        ? [
            ...appendedMessages,
            {
              id: `assistant-attachments-${nowIso}`,
              role: "assistant" as const,
              parts: assistantAttachmentParts,
            },
          ]
        : appendedMessages;
    const mergedMessages = appendWithoutDuplicateOverlap(nextMessages, appendedWithAttachments);
    await input.sessionDal.replaceMessages({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      messages: await materializeStoredMessageFiles(
        mergedMessages,
        input.container.artifactStore,
        undefined,
        artifactRecordScope,
      ),
      updatedAt: nowIso,
    });
    updatedSession =
      (await input.sessionDal.getById({
        tenantId: input.session.tenant_id,
        sessionId: input.session.session_id,
      })) ?? input.session;
  } else {
    const nextMessages = await materializeStoredMessageFiles(
      [
        ...input.session.messages,
        buildUserTurnMessage({
          parts: input.resolved.parts,
          fallbackText: input.resolved.message,
        }),
        createTextChatMessage({ role: "assistant", text: finalizedReply }),
      ],
      input.container.artifactStore,
      undefined,
      artifactRecordScope,
    );
    await input.sessionDal.replaceMessages({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      messages: nextMessages,
      updatedAt: nowIso,
    });
    updatedSession =
      (await input.sessionDal.getById({
        tenantId: input.session.tenant_id,
        sessionId: input.session.session_id,
      })) ?? input.session;
  }
  await maybeGenerateSessionTitle({
    container: input.container,
    sessionDal: input.sessionDal,
    session: updatedSession,
    resolved: input.resolved,
    reply: finalizedReply,
    model: input.model,
  });

  return AgentTurnResponse.parse({
    reply: finalizedReply,
    session_id: input.session.session_id,
    session_key: input.session.session_key,
    attachments: responseAttachments,
    used_tools: Array.from(input.usedTools),
    memory_written: memoryWritten,
  });
}
