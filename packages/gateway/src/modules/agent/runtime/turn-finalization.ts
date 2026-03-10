import { generateText, type LanguageModel } from "ai";
import type {
  AgentTurnResponse as AgentTurnResponseT,
  SessionTranscriptTextItem,
} from "@tyrum/schemas";
import { AgentTurnResponse } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { decideCrossTurnLoopWarning, LOOP_WARNING_PREFIX } from "../loop-detection.js";
import type { SessionDal, SessionRow } from "../session-dal.js";
import { recordMemoryV1SystemEpisode } from "../../memory/v1-episode-recorder.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { AgentContextReport, AgentLoadedContext } from "./types.js";
import { classifyTurnMemory } from "./turn-memory-policy.js";
import { normalizeSessionTitle } from "../session-dal-helpers.js";

type FinalizeContainer = Pick<GatewayContainer, "contextReportDal" | "logger" | "memoryV1Dal">;

function isAssistantTextTurn(
  turn: SessionRow["transcript"][number],
): turn is SessionTranscriptTextItem & { role: "assistant" } {
  return turn.kind === "text" && turn.role === "assistant";
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

  const previousAssistantMessages = input.session.transcript
    .filter(isAssistantTextTurn)
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
  session: SessionRow;
  title: string;
  bodyMd: string;
  tags: string[];
  resolved: ResolvedAgentTurnInput;
}): Promise<boolean> {
  await input.container.memoryV1Dal.create(
    {
      kind: "note",
      title: input.title,
      body_md: input.bodyMd,
      tags: input.tags,
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

async function recordAgentTurnEpisode(input: {
  container: FinalizeContainer;
  session: SessionRow;
  summaryMd: string;
  tags: string[];
  resolved: ResolvedAgentTurnInput;
  nowIso: string;
}): Promise<boolean> {
  try {
    await recordMemoryV1SystemEpisode(
      input.container.memoryV1Dal,
      {
        occurred_at: input.nowIso,
        channel: input.resolved.channel,
        event_type: "agent_turn",
        summary_md: input.summaryMd,
        tags: input.tags,
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
}): Promise<AgentTurnResponseT> {
  const nowIso = new Date().toISOString();
  const finalizedReply = applyCrossTurnLoopWarning(input);

  await persistContextReport(input);
  const updatedSession = await input.sessionDal.appendTurn({
    tenantId: input.session.tenant_id,
    sessionId: input.session.session_id,
    userMessage: input.resolved.message,
    assistantMessage: finalizedReply,
    timestamp: nowIso,
  });
  await maybeGenerateSessionTitle({
    container: input.container,
    sessionDal: input.sessionDal,
    session: updatedSession,
    resolved: input.resolved,
    reply: finalizedReply,
    model: input.model,
  });
  let noteWritten = false;
  let episodeWritten = false;

  if (input.ctx.config.memory.v1.enabled) {
    const decision = await classifyTurnMemory({
      model: input.model,
      config: input.ctx.config.memory.v1.auto_write,
      resolved: input.resolved,
      reply: finalizedReply,
      usedTools: input.usedTools,
      turnKind: input.turnKind ?? "normal",
      logger: input.container.logger,
    });

    if (decision.action === "note" || decision.action === "note_and_episode") {
      noteWritten = await writeMemoryV1TurnNote({
        container: input.container,
        session: input.session,
        title: decision.title,
        bodyMd: decision.bodyMd,
        tags: ["agent-turn", ...decision.tags],
        resolved: input.resolved,
      });
    }

    if (decision.action === "episode" || decision.action === "note_and_episode") {
      episodeWritten = await recordAgentTurnEpisode({
        container: input.container,
        session: input.session,
        summaryMd: decision.summaryMd,
        tags: ["agent", "turn", ...decision.tags],
        resolved: input.resolved,
        nowIso,
      });
    }
  }
  const memoryWritten = noteWritten || episodeWritten;

  return AgentTurnResponse.parse({
    reply: finalizedReply,
    session_id: input.session.session_id,
    session_key: input.session.session_key,
    used_tools: Array.from(input.usedTools),
    memory_written: memoryWritten,
  });
}
