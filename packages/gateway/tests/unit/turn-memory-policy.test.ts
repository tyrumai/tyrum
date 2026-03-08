import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { AgentConfig } from "@tyrum/schemas";
import { classifyTurnMemory } from "../../src/modules/agent/runtime/turn-memory-policy.js";
import { createStubLanguageModel } from "./stub-language-model.js";

function autoWriteConfig(overrides?: Partial<AgentConfig["memory"]["v1"]["auto_write"]>) {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    memory: { v1: { auto_write: overrides ?? {} } },
  }).memory.v1.auto_write;
}

function resolved(message: string) {
  return {
    channel: "test",
    thread_id: "thread-1",
    message,
  };
}

describe("classifyTurnMemory", () => {
  it("writes nothing for low-signal conversational turns", async () => {
    const decision = await classifyTurnMemory({
      model: createStubLanguageModel("ignored"),
      config: autoWriteConfig(),
      resolved: resolved("hi"),
      reply: "hello",
      usedTools: new Set(),
      turnKind: "normal",
    });

    expect(decision).toEqual({ action: "none", reasonCode: "none" });
  });

  it("uses deterministic note classification in rule-based mode", async () => {
    const decision = await classifyTurnMemory({
      model: createStubLanguageModel("ignored"),
      config: autoWriteConfig({ classifier: "rule_based" }),
      resolved: resolved("I prefer terse answers."),
      reply: "Understood.",
      usedTools: new Set(),
      turnKind: "normal",
    });

    expect(decision).toEqual(
      expect.objectContaining({
        action: "note",
        title: "User preference",
      }),
    );
  });

  it("does not drop explicit durable memory when the reply is generic", async () => {
    const decision = await classifyTurnMemory({
      model: createStubLanguageModel("ok"),
      config: autoWriteConfig(),
      resolved: resolved("remember that I prefer tea"),
      reply: "ok",
      usedTools: new Set(),
      turnKind: "normal",
    });

    expect(decision).toEqual(
      expect.objectContaining({
        action: "note",
        title: "User preference",
      }),
    );
  });

  it("accepts structured model-assisted note decisions", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              action: "note",
              reason_code: "explicit_preference",
              title: "User preference",
              body_md: "User prefers terse answers.",
              tags: ["Preference"],
            }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const decision = await classifyTurnMemory({
      model,
      config: autoWriteConfig(),
      resolved: resolved("I prefer terse answers."),
      reply: "Understood.",
      usedTools: new Set(),
      turnKind: "normal",
    });

    expect(decision).toEqual({
      action: "note",
      reasonCode: "explicit_preference",
      title: "User preference",
      bodyMd: "User prefers terse answers.",
      tags: ["preference"],
    });
  });

  it("falls back to deterministic notes when model-assisted note classification is invalid", async () => {
    const decision = await classifyTurnMemory({
      model: createStubLanguageModel("not json"),
      config: autoWriteConfig(),
      resolved: resolved("remember that our repo default branch is main"),
      reply: "I'll keep that in mind.",
      usedTools: new Set(),
      turnKind: "normal",
    });

    expect(decision).toEqual(
      expect.objectContaining({
        action: "note",
        title: "Remembered fact",
      }),
    );
  });
});
