import type { LanguageModel } from "ai";
import { generateText, stepCountIs } from "ai";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import { sha256HexFromString } from "../../policy/canonical-json.js";
import { redactSecretLikeText } from "./secrets.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import type { SessionMessage, SessionRow } from "../session-dal.js";
import type { AgentMemoryStore } from "../context-store.js";
import type { SqlDb } from "../../../statestore/types.js";

const DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS = 2_500;
const PRE_COMPACTION_FLUSH_TRUNCATION_MARKER = "...(truncated)";
const MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS = 2_000;

function computeTurnsDroppedByNextAppend(
  turns: readonly SessionMessage[],
  maxTurns: number,
): SessionMessage[] {
  const maxMessages = Math.max(1, maxTurns) * 2;
  const overflow = turns.length + 2 - maxMessages;
  if (overflow <= 0) return [];
  return turns.slice(0, overflow);
}

function formatPreCompactionFlushPrompt(droppedTurns: readonly SessionMessage[]): string {
  const lines = droppedTurns.map((turn) => {
    const role = turn.role === "assistant" ? "Assistant" : "User";
    const redacted = redactSecretLikeText(turn.content.trim());
    const content =
      redacted.length <= MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS
        ? redacted
        : `${redacted.slice(
            0,
            Math.max(
              0,
              MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS -
                PRE_COMPACTION_FLUSH_TRUNCATION_MARKER.length,
            ),
          )}${PRE_COMPACTION_FLUSH_TRUNCATION_MARKER}`;
    return `${role} (${turn.timestamp}): ${content}`;
  });

  return [
    "This is a silent internal pre-compaction memory flush.",
    "The following messages are about to be compacted from the session context due to the session max_turns limit.",
    "Extract any durable, non-secret memory worth keeping (preferences, constraints, decisions, procedures).",
    "If there is nothing worth storing, respond with NOOP.",
    "",
    "Messages being compacted:",
    ...lines,
  ].join("\n");
}

type LoggerLike = {
  warn: (message: string, fields?: Record<string, unknown>) => void;
};

export async function maybeRunPreCompactionMemoryFlush(
  deps: { db: SqlDb; logger: LoggerLike; agentId: string },
  input: {
    ctx: { config: AgentConfigT; memoryStore: AgentMemoryStore };
    session: SessionRow;
    model: LanguageModel;
    systemPrompt: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<void> {
  const v1Enabled = input.ctx.config.memory.v1.enabled;
  const markdownEnabled = input.ctx.config.memory.markdown_enabled;
  if (!v1Enabled && !markdownEnabled) {
    return;
  }

  const droppedTurns = computeTurnsDroppedByNextAppend(
    input.session.turns,
    input.ctx.config.sessions.max_turns,
  );
  if (droppedTurns.length === 0) {
    return;
  }

  const flushPromptText = formatPreCompactionFlushPrompt(droppedTurns);
  const flushKey = sha256HexFromString(`${input.session.session_id}\n${flushPromptText}`);
  const flushTag = `preflush:${flushKey}`;

  if (v1Enabled) {
    try {
      const memory = new MemoryV1Dal(deps.db);
      const existing = await memory.list({
        tenantId: input.session.tenant_id,
        agentId: deps.agentId,
        limit: 1,
        filter: { tags: [flushTag] },
      });
      if (existing.items.length > 0) {
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.warn("memory.flush_v1_dedupe_failed", {
        session_id: input.session.session_id,
        session_key: input.session.session_key,
        error: message,
      });
    }
  }

  const totalTimeoutMs = input.timeoutMs;
  const flushTimeoutMs = (() => {
    if (
      typeof totalTimeoutMs !== "number" ||
      !Number.isFinite(totalTimeoutMs) ||
      totalTimeoutMs <= 0
    ) {
      return DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS;
    }
    const slice = Math.floor(totalTimeoutMs * 0.1);
    if (slice <= 0) {
      return 0;
    }
    return Math.min(DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS, slice);
  })();
  if (flushTimeoutMs <= 0) {
    return;
  }

  try {
    const flushResult = await generateText({
      model: input.model,
      system: input.systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: flushPromptText,
            },
          ],
        },
      ],
      stopWhen: [stepCountIs(1)],
      abortSignal: input.abortSignal,
      timeout: flushTimeoutMs,
    });

    const rawFlushText = (flushResult.text ?? "").trim();
    if (rawFlushText.length === 0 || rawFlushText.toUpperCase() === "NOOP") {
      return;
    }

    const flushText = redactSecretLikeText(rawFlushText).trim();
    if (flushText.length === 0) {
      return;
    }

    if (flushText !== rawFlushText) {
      deps.logger.warn("memory.flush_redacted_secret_like", {
        session_id: input.session.session_id,
        session_key: input.session.session_key,
      });
    }

    const entry = ["Pre-compaction memory flush", "", flushText].join("\n").trim();

    if (v1Enabled) {
      try {
        const memory = new MemoryV1Dal(deps.db);
        await memory.create(
          {
            kind: "note",
            title: "Pre-compaction memory flush",
            body_md: flushText,
            tags: ["pre-compaction-flush", flushTag],
            sensitivity: "private",
            provenance: {
              source_kind: "system",
              session_id: input.session.session_id,
              refs: [],
              metadata: {
                kind: "pre_compaction_memory_flush",
                flush_key: flushKey,
                dropped_messages: droppedTurns.length,
              },
            },
          },
          { tenantId: input.session.tenant_id, agentId: deps.agentId },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.warn("memory.flush_v1_write_failed", {
          session_id: input.session.session_id,
          session_key: input.session.session_key,
          error: message,
        });
      }
    }

    if (markdownEnabled) {
      await input.ctx.memoryStore.appendDaily(entry);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn("memory.flush_failed", {
      session_id: input.session.session_id,
      session_key: input.session.session_key,
      error: message,
    });
  }
}
