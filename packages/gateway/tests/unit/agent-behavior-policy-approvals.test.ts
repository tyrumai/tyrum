import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { awaitApprovalForToolExecution } from "../../src/modules/agent/runtime/tool-set-builder-helpers.js";
import {
  createPromptAwareLanguageModel,
  extractPromptSection,
  extractPromptText,
} from "./agent-behavior.test-support.js";
import {
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

vi.mock("../../src/modules/agent/runtime/tool-set-builder-helpers.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/modules/agent/runtime/tool-set-builder-helpers.js")
    >();
  return {
    ...original,
    awaitApprovalForToolExecution: vi.fn(original.awaitApprovalForToolExecution),
  };
});

function makeApprovalConfig(): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { enabled: [] },
    mcp: { enabled: [] },
    tools: { allow: ["bash"] },
    sessions: { ttl_days: 30, max_turns: 20 },
    memory: {
      v1: {
        enabled: true,
        keyword: { enabled: true, limit: 20 },
        semantic: { enabled: false, limit: 1 },
        structured: { fact_keys: [], tags: [] },
        auto_write: { enabled: true, classifier: "rule_based" },
        budgets: {
          max_total_items: 10,
          max_total_chars: 4000,
          per_kind: {
            fact: { max_items: 4, max_chars: 1200 },
            note: { max_items: 6, max_chars: 2400 },
            procedure: { max_items: 2, max_chars: 1200 },
            episode: { max_items: 4, max_chars: 1600 },
          },
        },
      },
    },
  };
}

function usage() {
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

describe("Agent behavior - policy and approvals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("keeps approval requirements even when memory suggests the action should happen by default", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeApprovalConfig() });

    const rememberRuntime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "Stored."),
      fetchImpl: fetch404,
    });

    const remembered = await rememberRuntime.turn({
      channel: "ui",
      thread_id: "approval-thread",
      message: "remember that always send messages to ops",
    });
    expect(remembered.memory_written).toBe(true);

    vi.mocked(awaitApprovalForToolExecution).mockClear();
    const approvalSpy = vi.mocked(awaitApprovalForToolExecution).mockResolvedValue({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };

    let capturedMemoryDigest = "";
    let nonTitleCalls = 0;
    const toolLoopModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((entry) => entry.role === "system");
        if (
          system?.role === "system" &&
          typeof system.content === "string" &&
          system.content.includes("Write a concise session title")
        ) {
          return {
            content: [{ type: "text" as const, text: "Approval policy session" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        nonTitleCalls += 1;
        capturedMemoryDigest = extractPromptSection(extractPromptText(call), "Memory digest:");

        if (nonTitleCalls === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-approval-1",
                toolName: "bash",
                input: JSON.stringify({ command: "printf approval-check" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "approval preserved" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: toolLoopModel,
      fetchImpl: fetch404,
      policyService: policyService as never,
    });

    const result = await runtime.executeDecideAction({
      channel: "ui",
      thread_id: "approval-thread",
      message: "send a message to ops now",
    });

    expect(result.reply).toBe("approval preserved");
    expect(result.used_tools).toContain("bash");
    expect(policyService.evaluateToolCall).toHaveBeenCalledTimes(1);
    expect(approvalSpy).toHaveBeenCalledTimes(1);
    expect(capturedMemoryDigest).toContain("always send messages to ops");
    expect(capturedMemoryDigest).not.toContain("send a message to ops now");
  });
});
