import { generateText, type LanguageModel } from "ai";
import type { AgentTurnResponse as AgentTurnResponseT, TyrumUIMessage } from "@tyrum/schemas";
import { AgentTurnResponse } from "@tyrum/schemas";
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
  buildTurnMemoryDedupeTag,
  buildTurnMemoryDedupeKey,
  isTurnMemoryAutoWriteEnabled,
  normalizeTurnMemoryTags,
  resolveTurnMemoryOrigin,
  type StoredTurnMemoryDecision,
  type TurnMemoryDecisionCollector,
} from "./turn-memory-policy.js";
import { normalizeSessionTitle } from "../session-dal-helpers.js";

type FinalizeContainer = Pick<GatewayContainer, "contextReportDal" | "logger" | "memoryV1Dal">;

function isAssistantTextMessage(message: TyrumUIMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some((part) => part.type === "text" && typeof part["text"] === "string")
  );
}

function textFromChatMessage(message: TyrumUIMessage): string {
  return message.parts
    .flatMap((part) =>
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

function buildSignalMemoryTags(input: {
  decision: StoredTurnMemoryDecision;
  dedupeTag: string;
}): string[] {
  const payloadTags = normalizeTurnMemoryTags(input.decision.memory.tags);
  const prefix =
    input.decision.memory.kind === "episode"
      ? ["agent", "turn", "auto-turn"]
      : ["agent-turn", "auto-turn"];
  return normalizeTurnMemoryTags([...prefix, ...payloadTags, input.dedupeTag]);
}

async function hasExistingSignalMemory(input: {
  container: FinalizeContainer;
  session: SessionRow;
  dedupeTags: readonly string[];
}): Promise<boolean> {
  if (input.dedupeTags.length === 0) return false;
  const existing = await input.container.memoryV1Dal.list({
    tenantId: input.session.tenant_id,
    agentId: input.session.agent_id,
    limit: 1,
    filter: { tags: [...input.dedupeTags] },
  });
  return existing.items.length > 0;
}

async function writeTurnSignalMemory(input: {
  container: FinalizeContainer;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  decision: StoredTurnMemoryDecision;
  nowIso: string;
}): Promise<boolean> {
  const turnOrigin = resolveTurnMemoryOrigin(input.resolved.metadata);
  const dedupeKey = buildTurnMemoryDedupeKey(input.decision, turnOrigin);
  const dedupeTag = buildTurnMemoryDedupeTag(dedupeKey);
  const legacyDedupeTag = `auto-turn:${dedupeKey}`;
  if (
    await hasExistingSignalMemory({
      container: input.container,
      session: input.session,
      dedupeTags: [dedupeTag, legacyDedupeTag],
    })
  ) {
    return false;
  }

  const provenance = {
    source_kind: "system" as const,
    channel: input.resolved.channel,
    thread_id: input.resolved.thread_id,
    session_id: input.session.session_id,
    refs: [],
    metadata: {
      kind: "turn_signal",
      auto_turn: true,
      turn_origin: turnOrigin,
      reason: input.decision.reason,
      dedupe_key: dedupeKey,
    },
  };
  const tags = buildSignalMemoryTags({ decision: input.decision, dedupeTag });
  const memory = input.decision.memory;

  try {
    await input.container.memoryV1Dal.create(
      memory.kind === "fact"
        ? {
            kind: "fact",
            key: memory.key,
            value: memory.value,
            confidence: memory.confidence ?? 1,
            observed_at: input.nowIso,
            tags,
            sensitivity: "private",
            provenance,
          }
        : memory.kind === "note"
          ? {
              kind: "note",
              title: memory.title,
              body_md: memory.body_md,
              tags,
              sensitivity: "private",
              provenance,
            }
          : memory.kind === "procedure"
            ? {
                kind: "procedure",
                title: memory.title,
                body_md: memory.body_md,
                confidence: memory.confidence ?? 1,
                tags,
                sensitivity: "private",
                provenance,
              }
            : {
                kind: "episode",
                occurred_at: input.nowIso,
                summary_md: memory.summary_md,
                tags,
                sensitivity: "private",
                provenance,
              },
      { tenantId: input.session.tenant_id, agentId: input.session.agent_id },
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("memory.turn_signal_write_failed", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      error: message,
    });
    return false;
  }
}

function logTurnSignalProtocolState(input: {
  container: FinalizeContainer;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  collector: TurnMemoryDecisionCollector | undefined;
  turnKind: "normal" | "skip";
}): void {
  if (input.turnKind !== "normal") return;
  if (!input.collector) {
    input.container.logger.info("memory.turn_signal_missing", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      reason: "collector_unavailable",
    });
    return;
  }

  if (!input.collector.lastDecision) {
    input.container.logger.info("memory.turn_signal_missing", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      calls: input.collector.calls,
      invalid_calls: input.collector.invalidCalls,
      error: input.collector.lastError,
    });
    return;
  }

  if (input.collector.calls > 1 || input.collector.invalidCalls > 0) {
    input.container.logger.info("memory.turn_signal_protocol_violation", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      calls: input.collector.calls,
      invalid_calls: input.collector.invalidCalls,
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
        "Use 3 to 8 words, no quotes, no markdown, no trailing punctuation.",
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
  contextReport: AgentContextReport;
  turnKind?: "normal" | "skip";
  turnMemoryDecisionCollector?: TurnMemoryDecisionCollector;
  responseMessages?: readonly ModelMessage[];
}): Promise<AgentTurnResponseT> {
  const nowIso = new Date().toISOString();
  const finalizedReply = applyCrossTurnLoopWarning(input);

  await persistContextReport(input);
  let updatedSession: SessionRow;
  if (input.responseMessages) {
    const appendedMessages = applyFinalAssistantReply(
      modelMessagesToChatMessages(input.responseMessages),
      finalizedReply,
    );
    const nextMessages = [
      ...input.session.messages,
      createTextChatMessage({ role: "user", text: input.resolved.message }),
      ...appendedMessages,
    ];
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
  } else {
    const nextMessages = [
      ...input.session.messages,
      createTextChatMessage({ role: "user", text: input.resolved.message }),
      createTextChatMessage({ role: "assistant", text: finalizedReply }),
    ];
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

  const turnKind = input.turnKind ?? "normal";
  let memoryWritten = false;

  if (isTurnMemoryAutoWriteEnabled(input.ctx.config.memory.v1)) {
    logTurnSignalProtocolState({
      container: input.container,
      session: input.session,
      resolved: input.resolved,
      collector: input.turnMemoryDecisionCollector,
      turnKind,
    });

    const decision = input.turnMemoryDecisionCollector?.lastDecision;
    if (turnKind === "normal" && decision?.should_store) {
      memoryWritten = await writeTurnSignalMemory({
        container: input.container,
        session: input.session,
        resolved: input.resolved,
        decision,
        nowIso,
      });
    }
  }

  return AgentTurnResponse.parse({
    reply: finalizedReply,
    session_id: input.session.session_id,
    session_key: input.session.session_key,
    used_tools: Array.from(input.usedTools),
    memory_written: memoryWritten,
  });
}
