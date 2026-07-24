import type { AgentConfig } from "@tyrum/contracts";
import { toolIdsMatchForRollout } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../../statestore/types.js";
import type { AgentContextStore } from "../../agent/context-store.js";
import type { ConversationRow } from "../../agent/conversation-dal.js";
import { loadAgentConfigOrDefault } from "../../agent/default-config.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../../agent/persona.js";
import { resolveEffectiveAgentConfig } from "../../extensions/defaults-dal.js";
import { BUILTIN_MEMORY_SERVER_ID, resolveBuiltinMemoryConfig } from "../../memory/builtin-mcp.js";
import type { MemoryDal } from "../../memory/memory-dal.js";
import { buildMemoryDigest } from "../../memory/memory-digest.js";
import type { GatewayStateMode } from "../../runtime-state/mode.js";
import { buildHarnessSystemPromptAppend } from "../system-prompt.js";
import type { HarnessTurnContext } from "../types.js";

/**
 * The reads a harness turn plan is composed from.
 *
 * Kept apart from the planner itself so each input has one obvious owner and
 * neither module grows past the size gates.
 */

export interface HarnessPlannerLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

/** Tyrum tool id of the built-in durable-memory seed tool. */
const MEMORY_SEED_TOOL_ID = `mcp.${BUILTIN_MEMORY_SERVER_ID}.seed`;

/** True when the agent's pre-turn hydration list asks for durable-memory recall. */
function memorySeedRequested(config: AgentConfig): boolean {
  return config.mcp.pre_turn_tools.some((toolId) =>
    toolIdsMatchForRollout(toolId, MEMORY_SEED_TOOL_ID),
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The agent's stored config with tenant extension defaults applied. */
export async function loadEffectiveAgentConfig(input: {
  db: SqlDb;
  tenantId: string;
  agentId: string;
  stateMode: GatewayStateMode;
}): Promise<AgentConfig> {
  const config = await loadAgentConfigOrDefault({
    db: input.db,
    stateMode: input.stateMode,
    tenantId: input.tenantId,
    agentId: input.agentId,
  });
  return await resolveEffectiveAgentConfig({
    db: input.db,
    tenantId: input.tenantId,
    config,
  });
}

/**
 * Pre-turn durable-memory recall for a harness turn.
 *
 * Uses `buildMemoryDigest` rather than the native `runPreTurnHydration`, which
 * needs the whole native tool stack (resolved `ToolDescriptor`s, a
 * `ToolExecutor`, a `ToolExecutionContext`) that a harness turn never builds.
 *
 * Recall enriches the prompt; it is not load-bearing. A failure is reported and
 * the turn proceeds without it rather than failing the user's request.
 */
export async function loadHarnessRecallDigest(input: {
  memoryDal: MemoryDal;
  config: AgentConfig;
  context: HarnessTurnContext;
  query: string;
  logger: HarnessPlannerLogger;
}): Promise<string | undefined> {
  if (!memorySeedRequested(input.config)) return undefined;
  if (input.query.trim().length === 0) return undefined;

  const memoryConfig = resolveBuiltinMemoryConfig(input.config);
  if (!memoryConfig.enabled) return undefined;

  try {
    const digest = await buildMemoryDigest({
      dal: input.memoryDal,
      tenantId: input.context.tenantId,
      agentId: input.context.agentId,
      query: input.query,
      config: memoryConfig,
    });
    return digest.digest;
  } catch (err) {
    input.logger.warn("harness.plan.memory_recall_failed", {
      backend_id: input.context.backendId,
      conversation_id: input.context.conversationId,
      error: errorMessage(err),
    });
    return undefined;
  }
}

/** Tyrum identity/persona + conversation-state checkpoint + pre-turn recall. */
export async function buildHarnessPromptAppend(input: {
  contextStore: AgentContextStore;
  memoryDal: MemoryDal;
  context: HarnessTurnContext;
  conversation: ConversationRow;
  agentKey: string;
  config: AgentConfig;
  query: string;
  nowIso: string;
  stateMode: GatewayStateMode;
  logger: HarnessPlannerLogger;
}): Promise<string> {
  const scope = {
    tenantId: input.context.tenantId,
    agentId: input.context.agentId,
    workspaceId: input.context.workspaceId,
  };
  await input.contextStore.ensureAgentContext(scope);
  const storedIdentity = await input.contextStore.getIdentity(scope);
  const persona = resolveAgentPersona({
    agentKey: input.agentKey,
    config: input.config,
    identity: storedIdentity,
  });

  return buildHarnessSystemPromptAppend({
    context: input.context,
    // The persona must be applied before rendering, exactly as the native path
    // does; a raw store identity silently drops the configured name and tone.
    identity: applyPersonaToIdentity(storedIdentity, persona),
    checkpoint: input.conversation.context_state.checkpoint,
    recallDigest: await loadHarnessRecallDigest({
      memoryDal: input.memoryDal,
      config: input.config,
      context: input.context,
      query: input.query,
      logger: input.logger,
    }),
    nowIso: input.nowIso,
    stateMode: input.stateMode,
  });
}
