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
    skills: { enabled: [] },
    mcp: { enabled: [] },
    tools: { allow: [] },
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

function sessionTextTranscript(
  session: Awaited<ReturnType<GatewayContainer["sessionDal"]["getById"]>> | undefined,
): Array<{ role: string; content: string }> {
  return (
    session?.transcript.flatMap((item) =>
      item.kind === "text" ? [{ role: item.role, content: item.content }] : [],
    ) ?? []
  );
}

function noteBodies(container: GatewayContainer): Promise<string[]> {
  return container.memoryV1Dal
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

    const model = createPromptAwareLanguageModel(() => "Stored mango.");
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

    const turnSession = await containerA.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: turnResult.session_id,
    });
    const streamSession = await containerB.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: streamResult.session_id,
    });
    expect(sessionTextTranscript(streamSession)).toEqual(sessionTextTranscript(turnSession));
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

    const session = await containerA.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: handle.sessionId,
    });
    expect(sessionTextTranscript(session)).toEqual([]);
    expect(await noteBodies(containerA)).toEqual([]);
  });
});
