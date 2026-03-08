import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { ensureAgentConfigSeeded } from "../default-config.js";
import { loadCurrentAgentContext } from "../load-context.js";
import type { AgentContextStore } from "../context-store.js";
import type { SessionDal } from "../session-dal.js";
import type { SessionMessage, SessionRow } from "../session-dal.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import {
  resolveSessionModelDetailed,
  type ResolvedSessionModel,
} from "./session-model-resolution.js";
import type { ResolveSessionModelDeps } from "./session-model-resolution.js";
import type { AgentLoadedContext } from "./types.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";

const DEFAULT_RESERVED_INPUT_TOKENS = 20_000;
const DEFAULT_KEEP_LAST_MESSAGES_AFTER_COMPACTION = 2;
const DEFAULT_COMPACTION_TIMEOUT_MS = 5_000;
const CONTEXT_OVERFLOW_PATTERNS = [
  /context window/i,
  /context length/i,
  /maximum context/i,
  /token limit/i,
  /too many tokens/i,
  /too large/i,
  /input too long/i,
  /exceeds?.*context/i,
];
const COMPACTION_SYSTEM_PROMPT = [
  "You are a hidden session compaction assistant.",
  "Produce a detailed but concise summary that lets another agent continue the work safely.",
  "Focus on the user's goal, instructions, discoveries, work completed, work remaining, and relevant files/directories.",
  "Do not answer the conversation directly. Output only the summary.",
].join("\n");
const COMPACTION_USER_PROMPT = [
  "Provide a continuation summary for the conversation above.",
  "Use this template:",
  "",
  "## Goal",
  "",
  "[What the user is trying to accomplish.]",
  "",
  "## Instructions",
  "",
  "- [Important user instructions or constraints that must persist]",
  "- [Important plan/spec details the next agent must follow]",
  "",
  "## Discoveries",
  "",
  "[Notable technical findings, decisions, and facts learned so far.]",
  "",
  "## Accomplished",
  "",
  "[What is done, what is in progress, and what remains.]",
  "",
  "## Relevant files / directories",
  "",
  "[Only the files or directories that matter for continuing the work.]",
].join("\n");

export type SessionUsageSnapshot = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type LoggerLike = Pick<GatewayContainer["logger"], "warn">;

type EffectiveModelLimits = {
  input?: number;
  output?: number;
  context?: number;
};

export type SessionCompactionResult = {
  compacted: boolean;
  droppedMessages: number;
  keptMessages: number;
  summary: string;
  reason: "model" | "fallback" | "noop";
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

function buildSummaryHistoryMessages(
  previousSummary: string,
  droppedTurns: readonly SessionMessage[],
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  const trimmedSummary = previousSummary.trim();
  if (trimmedSummary.length > 0) {
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: `Summary so far:\n${trimmedSummary}` }],
    });
  }
  for (const turn of droppedTurns) {
    messages.push({
      role: turn.role,
      content: [{ type: "text", text: `[${turn.timestamp}] ${turn.content}` }],
    });
  }
  return messages;
}

function getDroppedTurns(session: SessionRow, keepLastMessages: number): SessionMessage[] {
  const overflow = session.turns.length - keepLastMessages;
  if (overflow <= 0) return [];
  return session.turns.slice(0, overflow);
}

function getKeptTurns(session: SessionRow, keepLastMessages: number): SessionMessage[] {
  if (keepLastMessages <= 0) return [];
  return session.turns.slice(-keepLastMessages);
}

function compactionTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_COMPACTION_TIMEOUT_MS;
  }
  const slice = Math.floor(timeoutMs * 0.25);
  if (slice <= 0) return undefined;
  return Math.min(DEFAULT_COMPACTION_TIMEOUT_MS, slice);
}

export function shouldCompactSessionForUsage(input: {
  config: AgentConfigT;
  session: SessionRow;
  modelResolution: ResolvedSessionModel;
  usage: SessionUsageSnapshot | undefined;
}): boolean {
  if (input.config.sessions.compaction?.auto === false) return false;

  const observedTokens = getObservedUsageTokens(input.usage);
  const limits = deriveEffectiveModelLimits(input.modelResolution);
  const reservedInputTokens = getReservedInputTokens(input.config);
  const usableFromInput =
    limits.input && limits.input > reservedInputTokens
      ? limits.input - reservedInputTokens
      : undefined;
  if (usableFromInput) {
    return observedTokens >= usableFromInput;
  }

  const reservedFromContext = limits.output ?? reservedInputTokens;
  const usableFromContext =
    limits.context && limits.context > reservedFromContext
      ? limits.context - reservedFromContext
      : undefined;
  if (usableFromContext) {
    return observedTokens >= usableFromContext;
  }

  const maxTurns = Math.max(1, input.config.sessions.max_turns);
  return input.session.turns.length >= maxTurns * 2;
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
  const droppedTurns = getDroppedTurns(input.session, keepLastMessages);
  if (droppedTurns.length === 0) {
    return {
      compacted: false,
      droppedMessages: 0,
      keptMessages: input.session.turns.length,
      summary: input.session.summary,
      reason: "noop",
    };
  }

  await maybeRunPreCompactionMemoryFlush(
    { db: input.container.db, logger: input.container.logger, agentId: input.session.agent_id },
    {
      ctx: input.ctx,
      session: input.session,
      model: input.model,
      droppedTurns,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs,
    },
  );

  const keptTurns = getKeptTurns(input.session, keepLastMessages);
  const timeout = compactionTimeoutMs(input.timeoutMs);

  try {
    const result = await generateText({
      model: input.model,
      system: COMPACTION_SYSTEM_PROMPT,
      messages: [
        ...buildSummaryHistoryMessages(input.session.summary, droppedTurns),
        { role: "user", content: [{ type: "text", text: COMPACTION_USER_PROMPT }] },
      ],
      stopWhen: [stepCountIs(1)],
      abortSignal: input.abortSignal,
      timeout,
    });
    const summary = (result.text ?? "").trim();
    if (summary.length === 0) {
      throw new Error("empty compaction summary");
    }

    await input.sessionDal.replaceTranscript({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      turns: keptTurns,
      summary,
    });

    return {
      compacted: true,
      droppedMessages: droppedTurns.length,
      keptMessages: keptTurns.length,
      summary,
      reason: "model",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.logger?.warn("agents.session_compaction_failed", {
      session_id: input.session.session_id,
      error: message,
    });
    const fallback = await input.sessionDal.compact({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
      keepLastMessages,
    });
    const updated = await input.sessionDal.getById({
      tenantId: input.session.tenant_id,
      sessionId: input.session.session_id,
    });
    return {
      compacted: true,
      droppedMessages: fallback.droppedMessages,
      keptMessages: fallback.keptMessages,
      summary: updated?.summary ?? input.session.summary,
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
  const modelResolution = await resolveSessionModelDetailed(input.resolveModelDeps, {
    config: ctx.config,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  return { ctx, session, modelResolution };
}

export function isContextOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}
