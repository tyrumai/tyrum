import { AgentConfig } from "@tyrum/schemas";
import { MockLanguageModelV3 } from "ai/test";
import { vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

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

export function findFlushPromptText(languageModel: MockLanguageModelV3): string {
  const call = listNonTitleGenerateCalls(languageModel).find((entry) =>
    extractUserPromptText(entry.prompt).includes("silent internal pre-compaction memory flush"),
  );
  return extractUserPromptText(call?.prompt);
}

export function countFlushCalls(languageModel: MockLanguageModelV3): number {
  return listNonTitleGenerateCalls(languageModel).filter((entry) =>
    extractUserPromptText(entry.prompt).includes("silent internal pre-compaction memory flush"),
  ).length;
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
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      if (isTitleGenerateCall(options as { prompt?: unknown[] })) {
        return titleGenerateResult();
      }
      const text = texts[callCount] ?? texts.at(-1) ?? "";
      callCount += 1;
      return {
        content: [{ type: "text" as const, text }],
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
        enabled: [],
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

export function createMockMcpManager() {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [] })),
  };
}
