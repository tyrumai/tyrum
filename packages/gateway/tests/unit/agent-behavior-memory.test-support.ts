import type { GatewayContainer } from "../../src/container.js";
import { loadCurrentAgentContext } from "../../src/modules/agent/load-context.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { compactSessionWithResolvedModel } from "../../src/modules/agent/runtime/session-compaction-service.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { extractPromptSection } from "./agent-behavior.test-support.js";
import { DEFAULT_TENANT_ID } from "./agent-runtime.test-helpers.js";

export type MemoryBudgets = {
  max_total_items: number;
  max_total_chars: number;
  per_kind: {
    fact: { max_items: number; max_chars: number };
    note: { max_items: number; max_chars: number };
    procedure: { max_items: number; max_chars: number };
    episode: { max_items: number; max_chars: number };
  };
};

export function makeMemoryConfig(input?: {
  maxTurns?: number;
  structuredFactKeys?: string[];
  structuredTags?: string[];
  budgets?: MemoryBudgets;
}): Record<string, unknown> {
  const memorySettings = {
    enabled: true,
    keyword: { enabled: true, limit: 20 },
    semantic: { enabled: false, limit: 1 },
    structured: {
      fact_keys: input?.structuredFactKeys ?? [],
      tags: input?.structuredTags ?? [],
    },
    budgets: input?.budgets ?? {
      max_total_items: 10,
      max_total_chars: 4000,
      per_kind: {
        fact: { max_items: 4, max_chars: 1200 },
        note: { max_items: 6, max_chars: 2400 },
        procedure: { max_items: 2, max_chars: 1200 },
        episode: { max_items: 4, max_chars: 1600 },
      },
    },
  };
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: { memory: memorySettings },
    },
    tools: { default_mode: "allow" },
    sessions: {
      ttl_days: 30,
      max_turns: input?.maxTurns ?? 20,
    },
  };
}

export function memorySection(promptText: string): string {
  return extractPromptSection(promptText, "Memory digest:");
}

export function noteDecision(body_md: string, tags?: string[]) {
  return {
    should_store: true as const,
    reason: "Durable user-provided information.",
    memory: {
      kind: "note" as const,
      body_md,
      tags,
    },
  };
}

export async function compactSessionForTest(
  runtime: AgentRuntime,
  input: { sessionId: string; keepLastMessages: number },
) {
  const runtimeState = runtime as unknown as {
    opts: ConstructorParameters<typeof AgentRuntime>[0];
    contextStore: ConstructorParameters<typeof AgentRuntime>[0]["contextStore"];
    sessionDal: GatewayContainer["sessionDal"];
    languageModelOverride?: ConstructorParameters<typeof AgentRuntime>[0]["languageModel"];
  };
  const session = await runtimeState.sessionDal.getById({
    tenantId: DEFAULT_TENANT_ID,
    sessionId: input.sessionId,
  });
  if (!session) {
    throw new Error(`expected session '${input.sessionId}'`);
  }

  const revision = await new AgentConfigDal(runtimeState.opts.container.db).getLatest({
    tenantId: session.tenant_id,
    agentId: session.agent_id,
  });
  if (!revision) {
    throw new Error(`expected agent config for '${session.agent_id}'`);
  }

  const ctx = await loadCurrentAgentContext({
    contextStore: runtimeState.contextStore!,
    tenantId: session.tenant_id,
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    config: revision.config,
  });
  if (!runtimeState.languageModelOverride) {
    throw new Error("expected test language model override");
  }

  return await compactSessionWithResolvedModel({
    container: runtimeState.opts.container,
    sessionDal: runtimeState.sessionDal,
    ctx,
    session,
    model: runtimeState.languageModelOverride,
    keepLastMessages: input.keepLastMessages,
    logger: runtimeState.opts.container.logger,
  });
}
