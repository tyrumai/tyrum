import { AgentConfig } from "@tyrum/contracts";
import { MockLanguageModelV3 } from "ai/test";
import { vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  BUILTIN_MEMORY_MCP_TOOLS,
  buildBuiltinMemoryServerSpec,
} from "../../src/modules/memory/builtin-mcp.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";

const TITLE_PROMPT_TEXT = "Write a concise session title.";

export function extractUserPromptText(prompt: unknown[] | undefined): string {
  return (prompt ?? [])
    .filter((msg): msg is { role: string; content: unknown } =>
      Boolean(msg && typeof msg === "object"),
    )
    .filter((msg) => msg.role === "user")
    .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text"),
    )
    .map((part) => part.text)
    .join("\n");
}

export function extractSystemPromptText(prompt: unknown[] | undefined): string {
  return (prompt ?? [])
    .filter((msg): msg is { role: string; content: unknown } =>
      Boolean(msg && typeof msg === "object"),
    )
    .filter((msg) => msg.role === "system")
    .flatMap((msg) => {
      if (typeof msg.content === "string") {
        return [msg.content];
      }
      return Array.isArray(msg.content)
        ? msg.content
            .filter((part): part is { type: "text"; text: string } =>
              Boolean(
                part && typeof part === "object" && (part as { type?: unknown }).type === "text",
              ),
            )
            .map((part) => part.text)
        : [];
    })
    .join("\n");
}

export function checkpointJson(handoffMd: string): string {
  return JSON.stringify({
    goal: "",
    user_constraints: [],
    decisions: [],
    discoveries: [],
    completed_work: [],
    pending_work: [],
    unresolved_questions: [],
    critical_identifiers: [],
    relevant_files: [],
    handoff_md: handoffMd,
  });
}

export function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

function isTitleGenerateCall(call: { prompt?: unknown[] } | undefined): boolean {
  return JSON.stringify(call?.prompt ?? []).includes(TITLE_PROMPT_TEXT);
}

export function listNonTitleGenerateCalls(
  languageModel: MockLanguageModelV3,
): { prompt: unknown[] }[] {
  return languageModel.doGenerateCalls.filter((call) => !isTitleGenerateCall(call)) as {
    prompt: unknown[];
  }[];
}

function isInitialFlushCall(call: { prompt: unknown[] }): boolean {
  if (!extractUserPromptText(call.prompt).includes("silent internal pre-compaction memory flush")) {
    return false;
  }
  return !call.prompt.some(
    (entry) =>
      Boolean(entry) && typeof entry === "object" && (entry as { role?: unknown }).role === "tool",
  );
}

export function findFlushPromptText(languageModel: MockLanguageModelV3): string {
  const call = listNonTitleGenerateCalls(languageModel).find(isInitialFlushCall);
  return extractUserPromptText(call?.prompt);
}

export function countFlushCalls(languageModel: MockLanguageModelV3): number {
  return listNonTitleGenerateCalls(languageModel).filter(isInitialFlushCall).length;
}

export function findFlushSystemText(languageModel: MockLanguageModelV3): string {
  const call = listNonTitleGenerateCalls(languageModel).find(isInitialFlushCall);
  return extractSystemPromptText(call?.prompt);
}

function titleGenerateResult() {
  return {
    content: [{ type: "text" as const, text: "Generated session title" }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

export function createSequencedTextLanguageModel(texts: readonly string[]): MockLanguageModelV3 {
  return createSequencedGenerateLanguageModel(texts);
}

type GenerateStep =
  | string
  | {
      kind: "tool-call";
      toolName: string;
      input: string | Record<string, unknown>;
    };

export function createMemoryWriteToolStep(input: Record<string, unknown>): GenerateStep {
  return {
    kind: "tool-call",
    toolName: "mcp.memory.write",
    input,
  };
}

export function createSequencedGenerateLanguageModel(
  steps: readonly GenerateStep[],
): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      if (isTitleGenerateCall(options as { prompt?: unknown[] })) {
        return titleGenerateResult();
      }
      const step = steps[callCount] ?? steps.at(-1) ?? "";
      callCount += 1;

      if (typeof step !== "string") {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `tc-${String(callCount)}`,
              toolName: step.toolName,
              input: typeof step.input === "string" ? step.input : JSON.stringify(step.input),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: step }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

export async function seedAgentConfig(
  container: GatewayContainer,
  opts?: { maxTurns?: number },
): Promise<{ tenantId: string; agentId: string }> {
  const tenantId = DEFAULT_TENANT_ID;
  const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "default");
  await new AgentConfigDal(container.db).set({
    tenantId,
    agentId,
    config: AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: [] },
      mcp: {
        default_mode: "deny",
        allow: ["memory"],
        pre_turn_tools: ["mcp.memory.seed"],
        server_settings: { memory: { enabled: true } },
      },
      tools: { allow: [] },
      sessions: {
        ttl_days: 30,
        max_turns: opts?.maxTurns ?? 1,
        compaction: {
          auto: true,
          reserved_input_tokens: 1,
          keep_last_messages_after_compaction: 1,
        },
      },
    }),
    createdBy: { kind: "test" },
    reason: "pre-compaction flush test",
  });
  return { tenantId, agentId };
}

function createBuiltinMemoryToolDescriptors(): ToolDescriptor[] {
  const spec = buildBuiltinMemoryServerSpec();
  const overrides = spec.tool_overrides ?? {};
  return BUILTIN_MEMORY_MCP_TOOLS.map((tool) => {
    const override = overrides[tool.name];
    return {
      id: `mcp.${spec.id}.${tool.name}`,
      description: tool.description?.trim().length
        ? `${tool.description.trim()} (server=${spec.name})`
        : `MCP tool '${tool.name}' from server '${spec.name}'.`,
      effect: override?.effect ?? tool.effect ?? "state_changing",
      keywords: [
        "mcp",
        spec.id.toLowerCase(),
        spec.name.toLowerCase(),
        tool.name.toLowerCase(),
        ...(tool.keywords ?? []),
      ],
      source: "mcp",
      family: "mcp",
      backingServerId: spec.id,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : undefined,
      promptGuidance: tool.promptGuidance,
      promptExamples: tool.promptExamples,
      preTurnHydration: override?.pre_turn_hydration
        ? {
            promptArgName: override.pre_turn_hydration.prompt_arg_name,
            includeTurnContext: override.pre_turn_hydration.include_turn_context,
          }
        : tool.preTurnHydration,
      memoryRole: override?.memory_role ?? tool.memoryRole,
    };
  });
}

export function createMockMcpManager() {
  const descriptors = createBuiltinMemoryToolDescriptors();
  return {
    listToolDescriptors: vi.fn(async () => descriptors),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [] })),
  };
}
