import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type {
  AgentConfig as AgentConfigT,
  CheckpointSummary,
  TyrumUIMessage,
} from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { ensureAgentConfigSeeded } from "../default-config.js";
import { loadCurrentAgentContext } from "../load-context.js";
import type { AgentContextStore } from "../context-store.js";
import type { SessionDal } from "../session-dal.js";
import type { SessionRow } from "../session-dal.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import {
  buildPromptVisibleMessages,
  collectPendingApprovals,
  collectPendingToolStates,
  estimatePromptTokens,
  extractCriticalIdentifiers,
  extractRelevantFiles,
  splitMessagesForContextCompaction,
} from "./session-context-state.js";
import { buildDeterministicFallbackCheckpoint } from "./session-compaction-fallback.js";
import {
  buildCompactionInstruction,
  COMPACTION_JSON_SCHEMA,
  findCheckpointDeficiencies,
} from "./session-compaction-prompt.js";
import {
  resolveSessionModelDetailed,
  type ResolvedSessionModel,
} from "./session-model-resolution.js";
import type { ResolveSessionModelDeps } from "./session-model-resolution.js";
import type { AgentLoadedContext } from "./types.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";

const DEFAULT_RESERVED_INPUT_TOKENS = 20_000;
const DEFAULT_KEEP_LAST_MESSAGES_AFTER_COMPACTION = 12;
const DEFAULT_COMPACTION_TIMEOUT_MS = 8_000;
const CONTEXT_OVERFLOW_PATTERNS = [
  /context window/i,
  /context length/i,
  /maximum context/i,
  /token limit/i,
  /too many tokens/i,
  /(?:input|prompt|message).{0,40}too large/i,
  /(?:input|prompt|message).{0,40}too long/i,
  /exceeds?.*context/i,
] as const;

type LoggerLike = Pick<GatewayContainer["logger"], "warn">;

type EffectiveModelLimits = {
  input?: number;
  output?: number;
  context?: number;
};

export type SessionUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type SessionCompactionResult = {
  compacted: boolean;
  droppedMessages: number;
  keptMessages: number;
  summary: string;
  reason: "fallback" | "model" | "noop";
};

function asPositiveLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function minimumPositive(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  if (filtered.length === 0) return undefined;
  return Math.min(...filtered);
}

function deriveEffectiveModelLimits(modelResolution: ResolvedSessionModel): EffectiveModelLimits {
  return {
    input: minimumPositive(
      modelResolution.candidates.map((candidate) =>
        asPositiveLimit(candidate.model.limit?.["input"]),
      ),
    ),
    output: minimumPositive(
      modelResolution.candidates.map((candidate) =>
        asPositiveLimit(candidate.model.limit?.["output"]),
      ),
    ),
    context: minimumPositive(
      modelResolution.candidates.map((candidate) =>
        asPositiveLimit(candidate.model.limit?.["context"]),
      ),
    ),
  };
}

function getObservedUsageTokens(usage: SessionUsageSnapshot | undefined): number {
  if (!usage) return 0;
  if (typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
    return Math.max(0, Math.floor(usage.inputTokens));
  }
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    return Math.max(0, Math.floor(usage.totalTokens));
  }
  const output =
    typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : 0;
  return Math.max(0, Math.floor(output));
}

function getKeepLastMessages(config: AgentConfigT): number {
  return Math.max(
    0,
    config.sessions.compaction?.keep_last_messages_after_compaction ??
      DEFAULT_KEEP_LAST_MESSAGES_AFTER_COMPACTION,
  );
}

function getReservedInputTokens(config: AgentConfigT): number {
  return Math.max(
    0,
    config.sessions.compaction?.reserved_input_tokens ?? DEFAULT_RESERVED_INPUT_TOKENS,
  );
}

function recentMessageCount(session: SessionRow): number {
  if (session.context_state.recent_message_ids.length > 0) {
    return session.context_state.recent_message_ids.length;
  }

  const compactedThroughMessageId = session.context_state.compacted_through_message_id;
  if (!compactedThroughMessageId) {
    return session.messages.length;
  }

  const compactedIndex = session.messages.findIndex(
    (message) => message.id === compactedThroughMessageId,
  );
  if (compactedIndex < 0) {
    return 0;
  }

  return Math.max(0, session.messages.length - compactedIndex - 1);
}

function trimJsonFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split("\n");
  const inner = lines.slice(1, -1).join("\n").trim();
  return inner || trimmed;
}

async function generateCheckpointSummary(input: {
  model: LanguageModel;
  previousCheckpoint: CheckpointSummary | null;
  droppedMessages: readonly TyrumUIMessage[];
  criticalIdentifiers: readonly string[];
  relevantFiles: readonly string[];
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<CheckpointSummary> {
  let lastError: Error | undefined;
  let auditFeedback: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateText({
        model: input.model,
        system:
          "Return strict JSON only. Do not wrap the answer in markdown fences or prose. " +
          "Do not omit any keys; use empty strings or empty arrays when needed.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  buildCompactionInstruction({
                    previousCheckpoint: input.previousCheckpoint,
                    droppedMessages: input.droppedMessages,
                    criticalIdentifiers: input.criticalIdentifiers,
                    relevantFiles: input.relevantFiles,
                    auditFeedback,
                  }) +
                  (attempt === 0
                    ? ""
                    : "\n\nYour previous answer failed validation. Fix every listed issue and return strict JSON only."),
              },
            ],
          },
        ],
        abortSignal: input.abortSignal,
        timeout: input.timeoutMs ?? DEFAULT_COMPACTION_TIMEOUT_MS,
      });
      const parsed = COMPACTION_JSON_SCHEMA.parse(JSON.parse(trimJsonFence(result.text ?? "")));
      const mergedIdentifiers = Array.from(
        new Set([...input.criticalIdentifiers, ...parsed.critical_identifiers]),
      );
      const mergedFiles = Array.from(new Set([...input.relevantFiles, ...parsed.relevant_files]));
      const checkpoint: CheckpointSummary = {
        ...parsed,
        critical_identifiers: mergedIdentifiers,
        relevant_files: mergedFiles,
      };
      const deficiencies = findCheckpointDeficiencies({
        checkpoint,
        criticalIdentifiers: input.criticalIdentifiers,
        droppedMessages: input.droppedMessages,
      });
      if (deficiencies.length > 0) {
        auditFeedback = deficiencies;
        lastError = new Error(deficiencies.join(" "));
        continue;
      }
      return checkpoint;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      auditFeedback ??= ["Return strict JSON that matches the required schema exactly."];
    }
  }
  throw lastError ?? new Error("failed to generate checkpoint summary");
}

export function shouldCompactSessionForUsage(input: {
  config: AgentConfigT;
  session: SessionRow;
  modelResolution: ResolvedSessionModel;
  usage: SessionUsageSnapshot | undefined;
  currentTurnText?: string;
  systemPrompt?: string;
}): boolean {
  if (input.config.sessions.compaction?.auto === false) return false;

  // Prompt-only compaction keeps full session history in storage, so the
  // compatibility max_turns fallback has to consider only the still-visible
  // recent messages instead of the persisted message array.
  const maxTurns = Math.floor(input.config.sessions.max_turns);
  const maxTurnsExceeded =
    Number.isFinite(maxTurns) && maxTurns > 0 && recentMessageCount(input.session) >= maxTurns * 2;

  const limits = deriveEffectiveModelLimits(input.modelResolution);
  const reservedInputTokens = getReservedInputTokens(input.config);
  const observedTokens = getObservedUsageTokens(input.usage);
  const promptTokens =
    observedTokens > 0
      ? observedTokens
      : estimatePromptTokens({
          messages: buildPromptVisibleMessages(input.session.messages, input.session.context_state),
          systemPrompt: input.systemPrompt,
          userContent: input.currentTurnText
            ? [{ type: "text", text: input.currentTurnText }]
            : undefined,
        });

  const usableFromInput =
    limits.input && limits.input > reservedInputTokens
      ? limits.input - reservedInputTokens
      : undefined;
  if (usableFromInput) {
    return promptTokens >= usableFromInput || maxTurnsExceeded;
  }

  const reservedFromContext = limits.output ?? reservedInputTokens;
  const usableFromContext =
    limits.context && limits.context > reservedFromContext
      ? limits.context - reservedFromContext
      : undefined;
  if (usableFromContext) {
    return promptTokens >= usableFromContext || maxTurnsExceeded;
  }

  return maxTurnsExceeded;
}

function compactionTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_COMPACTION_TIMEOUT_MS;
  }
  return Math.min(DEFAULT_COMPACTION_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs * 0.25)));
}

export async function compactSessionWithResolvedModel(input: {
  container: GatewayContainer;
  sessionDal: SessionDal;
  ctx: AgentLoadedContext;
  session: SessionRow;
  model: LanguageModel;
  keepLastMessages?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  logger?: LoggerLike;
}): Promise<SessionCompactionResult> {
  const keepLastMessages = Math.max(
    0,
    input.keepLastMessages ?? getKeepLastMessages(input.ctx.config),
  );
  const { dropped, kept } = splitMessagesForContextCompaction({
    messages: input.session.messages,
    keepLastMessages,
  });
  if (dropped.length === 0) {
    return {
      compacted: false,
      droppedMessages: 0,
      keptMessages: kept.length,
      summary: input.session.context_state.checkpoint?.handoff_md ?? "",
      reason: "noop",
    };
  }

  await maybeRunPreCompactionMemoryFlush(
    { db: input.container.db, logger: input.container.logger, agentId: input.session.agent_id },
    {
      ctx: input.ctx,
      session: input.session,
      model: input.model,
      droppedMessages: dropped,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs,
    },
  );

  try {
    const criticalIdentifiers = extractCriticalIdentifiers(dropped);
    const relevantFiles = extractRelevantFiles(criticalIdentifiers);
    const checkpoint = await generateCheckpointSummary({
      model: input.model,
      previousCheckpoint: input.session.context_state.checkpoint,
      droppedMessages: dropped,
      criticalIdentifiers,
      relevantFiles,
      abortSignal: input.abortSignal,
      timeoutMs: compactionTimeoutMs(input.timeoutMs),
    });

    await input.sessionDal.replaceContextState({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      updatedAt: new Date().toISOString(),
      contextState: {
        version: 1,
        compacted_through_message_id: dropped.at(-1)?.id,
        recent_message_ids: kept.map((message) => message.id),
        checkpoint,
        pending_approvals: collectPendingApprovals(input.session.messages),
        pending_tool_state: collectPendingToolStates(input.session.messages),
        updated_at: new Date().toISOString(),
      },
    });

    return {
      compacted: true,
      droppedMessages: dropped.length,
      keptMessages: kept.length,
      summary: checkpoint.handoff_md,
      reason: "model",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    input.logger?.warn("agents.session_compaction_failed", {
      session_id: input.session.session_id,
      error: errorMessage,
    });
    const criticalIdentifiers = extractCriticalIdentifiers(dropped);
    const relevantFiles = extractRelevantFiles(criticalIdentifiers);
    const fallbackCheckpoint = buildDeterministicFallbackCheckpoint({
      previousCheckpoint: input.session.context_state.checkpoint,
      droppedMessages: dropped,
      criticalIdentifiers,
      relevantFiles,
    });
    await input.sessionDal.replaceContextState({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      updatedAt: new Date().toISOString(),
      contextState: {
        version: 1,
        compacted_through_message_id: dropped.at(-1)?.id,
        recent_message_ids: kept.map((keptMessage) => keptMessage.id),
        checkpoint: fallbackCheckpoint,
        pending_approvals: collectPendingApprovals(input.session.messages),
        pending_tool_state: collectPendingToolStates(input.session.messages),
        updated_at: new Date().toISOString(),
      },
    });
    return {
      compacted: true,
      droppedMessages: dropped.length,
      keptMessages: kept.length,
      summary: fallbackCheckpoint.handoff_md,
      reason: "fallback",
    };
  }
}

export async function resolveRuntimeCompactionContext(input: {
  container: GatewayContainer;
  contextStore: AgentContextStore;
  sessionDal: SessionDal;
  resolveModelDeps: ResolveSessionModelDeps;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  sessionId: string;
}): Promise<{
  ctx: AgentLoadedContext;
  session: SessionRow;
  modelResolution: ResolvedSessionModel;
}> {
  const session = await input.sessionDal.getById({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  if (!session) throw new Error(`session '${input.sessionId}' not found`);

  const revision = await ensureAgentConfigSeeded({
    db: input.container.db,
    stateMode: resolveGatewayStateMode(input.container.deploymentConfig),
    tenantId: input.tenantId,
    agentId: input.agentId,
    agentKey: input.agentId,
    createdBy: { kind: "agent-runtime" },
    reason: "session compaction",
  });
  const ctx = await loadCurrentAgentContext({
    contextStore: input.contextStore,
    tenantId: input.tenantId,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    config: revision.config,
  });
  const compactionModel = ctx.config.sessions.compaction?.model;
  const compactionConfig =
    compactionModel &&
    compactionModel.provider_id.trim().length > 0 &&
    compactionModel.model_id.trim().length > 0
      ? {
          ...ctx.config,
          model: {
            ...ctx.config.model,
            model: `${compactionModel.provider_id}/${compactionModel.model_id}`,
            fallback: [],
          },
        }
      : ctx.config;
  const modelResolution = await resolveSessionModelDetailed(input.resolveModelDeps, {
    config: compactionConfig,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  return { ctx, session, modelResolution };
}

export function isContextOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}
