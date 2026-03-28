import { afterEach, describe, expect, it } from "vitest";
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createPromptAwareLanguageModel } from "./agent-behavior.test-support.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

function makeMemoryConfig(): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        memory: {
          enabled: true,
          keyword: { enabled: true, limit: 20 },
          semantic: { enabled: false, limit: 1 },
          structured: { fact_keys: [], tags: [] },
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
    },
    tools: { default_mode: "allow" },
    conversations: { ttl_days: 30, max_turns: 20 },
  };
}

function noteDecision(body_md: string) {
  return {
    should_store: true as const,
    reason: "Durable user preference.",
    memory: {
      kind: "note" as const,
      body_md,
    },
  };
}

function conversationTextTranscript(
  conversation: Awaited<ReturnType<GatewayContainer["conversationDal"]["getById"]>> | undefined,
): Array<{ role: string; content: string }> {
  return (
    conversation?.transcript.flatMap((item) =>
      item.kind === "text" ? [{ role: item.role, content: item.content }] : [],
    ) ?? []
  );
}

function noteBodies(container: GatewayContainer): Promise<string[]> {
  return container.memoryDal
    .list({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
    })
    .then((result) => result.items.flatMap((item) => (item.kind === "note" ? [item.body_md] : [])));
}

function createFailingStreamModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "failing-stream",
    supportedUrls: {},
    async doGenerate(): Promise<LanguageModelV3GenerateResult> {
      return {
        content: [{ type: "text" as const, text: "unused" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream(): Promise<LanguageModelV3StreamResult> {
      throw new Error("stream failed");
    },
  };
}

describe("Agent behavior - stream parity", () => {
  let homeDirA: string | undefined;
  let containerA: GatewayContainer | undefined;
  let homeDirB: string | undefined;
  let containerB: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir: homeDirA, container: containerA });
    await teardownTestEnv({ homeDir: homeDirB, container: containerB });
    containerA = undefined;
    homeDirA = undefined;
    containerB = undefined;
    homeDirB = undefined;
  });

  it("persists the same reply, transcript, and memory writes through turn() and turnStream()", async () => {
    ({ homeDir: homeDirA, container: containerA } = await setupTestEnv());
    ({ homeDir: homeDirB, container: containerB } = await setupTestEnv());
    await seedAgentConfig(containerA, { config: makeMemoryConfig() });
    await seedAgentConfig(containerB, { config: makeMemoryConfig() });

    const model = createPromptAwareLanguageModel(() => "Stored mango.", {
      memoryDecision: ({ latestUserText }) =>
        latestUserText.toLowerCase().includes("remember that my favorite fruit is mango")
          ? noteDecision("remember that my favorite fruit is mango")
          : undefined,
    });
    const turnRuntime = new AgentRuntime({
      container: containerA,
      home: homeDirA,
      languageModel: model,
      fetchImpl: fetch404,
    });
    const streamRuntime = new AgentRuntime({
      container: containerB,
      home: homeDirB,
      languageModel: model,
      fetchImpl: fetch404,
    });

    const request = {
      channel: "ui",
      thread_id: "stream-parity-thread",
      message: "remember that my favorite fruit is mango",
    } as const;

    const turnResult = await turnRuntime.turn(request);
    const streamHandle = await streamRuntime.turnStream(request);
    const streamResult = await streamHandle.finalize();

    expect(streamResult.reply).toBe(turnResult.reply);
    expect(streamResult.used_tools).toEqual(turnResult.used_tools);
    expect(streamResult.memory_written).toBe(turnResult.memory_written);

    const turnConversation = await containerA.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: turnResult.conversation_id,
    });
    const streamConversation = await containerB.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: streamResult.conversation_id,
    });
    expect(conversationTextTranscript(streamConversation)).toEqual(
      conversationTextTranscript(turnConversation),
    );
    expect(await noteBodies(containerB)).toEqual(await noteBodies(containerA));
  });

  it("does not persist an assistant reply or memory when streamed finalize fails", async () => {
    ({ homeDir: homeDirA, container: containerA } = await setupTestEnv());
    await seedAgentConfig(containerA, { config: makeMemoryConfig() });

    const runtime = new AgentRuntime({
      container: containerA,
      home: homeDirA,
      languageModel: createFailingStreamModel(),
      fetchImpl: fetch404,
    });

    const handle = await runtime.turnStream({
      channel: "ui",
      thread_id: "stream-failure-thread",
      message: "remember that my favorite fruit is mango",
    });

    await expect(handle.finalize()).rejects.toThrow(/No output generated|stream failed/u);

    const conversation = await containerA.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: handle.conversationId,
    });
    expect(conversationTextTranscript(conversation)).toEqual([]);
    expect(await noteBodies(containerA)).toEqual([]);
  });
});
