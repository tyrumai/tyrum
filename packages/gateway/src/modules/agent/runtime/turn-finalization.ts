import type { AgentTurnResponse as AgentTurnResponseT } from "@tyrum/schemas";
import { AgentTurnResponse } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { decideCrossTurnLoopWarning, LOOP_WARNING_PREFIX } from "../loop-detection.js";
import type { SessionDal, SessionRow } from "../session-dal.js";
import { recordMemoryV1SystemEpisode } from "../../memory/v1-episode-recorder.js";
import { looksLikeSecretText } from "./secrets.js";
import { shouldPromoteToCoreMemory, type ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { AgentContextReport, AgentLoadedContext } from "./types.js";
import { redactSecretLikeText } from "./secrets.js";

type FinalizeContainer = Pick<GatewayContainer, "contextReportDal" | "logger" | "memoryV1Dal">;

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

  const previousAssistantMessages = input.session.turns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.content);
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

async function writeMemoryV1TurnNote(input: {
  container: FinalizeContainer;
  ctx: AgentLoadedContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
}): Promise<boolean> {
  if (!input.ctx.config.memory.v1.enabled) return false;

  const entry = [
    `Channel: ${input.resolved.channel}`,
    `Thread: ${input.resolved.thread_id}`,
    `User: ${input.resolved.message}`,
    `Assistant: ${input.reply}`,
  ].join("\n");
  if (looksLikeSecretText(entry)) {
    input.container.logger.warn("memory.write_skipped_secret_like", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
    });
    return false;
  }

  if (!shouldPromoteToCoreMemory(input.resolved.message)) {
    return false;
  }

  await input.container.memoryV1Dal.create(
    {
      kind: "note",
      title: "Learned preference",
      body_md: entry,
      tags: ["agent-turn", "learned-preference"],
      sensitivity: "private",
      provenance: {
        source_kind: "user",
        channel: input.resolved.channel,
        thread_id: input.resolved.thread_id,
        session_id: input.session.session_id,
        refs: [],
      },
    },
    { tenantId: input.session.tenant_id, agentId: input.session.agent_id },
  );
  return true;
}

function normalizeSummaryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateSummaryText(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3)}...`;
}

function buildTurnEpisodeSummary(input: {
  resolved: ResolvedAgentTurnInput;
  reply: string;
}): string {
  const user = truncateSummaryText(
    normalizeSummaryText(redactSecretLikeText(input.resolved.message)),
    160,
  );
  const assistant = truncateSummaryText(
    normalizeSummaryText(redactSecretLikeText(input.reply)),
    220,
  );
  const details = [
    user.length > 0 ? `User: ${user}` : undefined,
    assistant.length > 0 ? `Assistant: ${assistant}` : undefined,
  ].filter((part): part is string => part !== undefined);

  if (details.length === 0) {
    return `Agent turn: ${input.resolved.channel}`;
  }

  return `${details.join(" | ")} (${input.resolved.channel})`;
}

async function recordAgentTurnEpisode(input: {
  container: FinalizeContainer;
  ctx: AgentLoadedContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  nowIso: string;
}): Promise<boolean> {
  if (!input.ctx.config.memory.v1.enabled) {
    return false;
  }
  try {
    await recordMemoryV1SystemEpisode(
      input.container.memoryV1Dal,
      {
        occurred_at: input.nowIso,
        channel: input.resolved.channel,
        event_type: "agent_turn",
        summary_md: buildTurnEpisodeSummary(input),
        tags: ["agent", "turn"],
        metadata: {
          channel: input.resolved.channel,
          thread_id: input.resolved.thread_id,
          session_id: input.session.session_id,
        },
      },
      input.session.agent_id,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("memory.v1.system_episode_record_failed", {
      session_id: input.session.session_id,
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      error: message,
    });
    return false;
  }
}

export async function finalizeTurn(input: {
  container: FinalizeContainer;
  sessionDal: SessionDal;
  ctx: AgentLoadedContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  usedTools: ReadonlySet<string>;
  contextReport: AgentContextReport;
}): Promise<AgentTurnResponseT> {
  const nowIso = new Date().toISOString();
  const finalizedReply = applyCrossTurnLoopWarning(input);

  await persistContextReport(input);
  await input.sessionDal.appendTurn({
    tenantId: input.session.tenant_id,
    sessionId: input.session.session_id,
    userMessage: input.resolved.message,
    assistantMessage: finalizedReply,
    maxTurns: input.ctx.config.sessions.max_turns,
    timestamp: nowIso,
  });
  const noteWritten = await writeMemoryV1TurnNote({
    container: input.container,
    ctx: input.ctx,
    session: input.session,
    resolved: input.resolved,
    reply: finalizedReply,
  });
  const episodeWritten = await recordAgentTurnEpisode({
    container: input.container,
    ctx: input.ctx,
    session: input.session,
    resolved: input.resolved,
    reply: finalizedReply,
    nowIso,
  });
  const memoryWritten = noteWritten || episodeWritten;

  return AgentTurnResponse.parse({
    reply: finalizedReply,
    session_id: input.session.session_id,
    session_key: input.session.session_key,
    used_tools: Array.from(input.usedTools),
    memory_written: memoryWritten,
  });
}
