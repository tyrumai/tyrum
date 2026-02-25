import { describe, expect, it } from "vitest";
import { decideCrossTurnLoopWarning, detectWithinTurnToolLoop, signatureForToolStep } from "../../src/modules/agent/loop-detection.js";

describe("detectWithinTurnToolLoop", () => {
  it("reports all tool names in an alternating cycle", () => {
    const steps = [
      { toolCalls: [{ toolName: "tool.fs.read", input: { path: "a.txt" } }] },
      { toolCalls: [{ toolName: "tool.exec.bash", input: { cmd: "echo hi" } }] },
      { toolCalls: [{ toolName: "tool.fs.read", input: { path: "a.txt" } }] },
      { toolCalls: [{ toolName: "tool.exec.bash", input: { cmd: "echo hi" } }] },
      { toolCalls: [{ toolName: "tool.fs.read", input: { path: "a.txt" } }] },
      { toolCalls: [{ toolName: "tool.exec.bash", input: { cmd: "echo hi" } }] },
    ];

    const result = detectWithinTurnToolLoop({
      steps,
      consecutiveRepeatLimit: 10,
      cycleRepeatLimit: 3,
    });

    expect(result).toEqual({
      kind: "cycle",
      toolNames: ["tool.fs.read", "tool.exec.bash"],
    });
  });
});

describe("signatureForToolStep", () => {
  it("does not crash when tool call input is missing", () => {
    const result = signatureForToolStep({
      toolCalls: [{ toolName: "tool.fs.read" }],
    });

    expect(result).toEqual({
      signature: expect.stringMatching(/^tool\.fs\.read:[0-9a-f]{64}$/),
      toolNames: ["tool.fs.read"],
    });
  });
});

describe("decideCrossTurnLoopWarning", () => {
  it("does not warn when tokenization produces no comparable tokens", () => {
    const messageA = "这是一个很长的中文消息。".repeat(20);
    const messageB = "完全不同的中文内容，用于测试。".repeat(20);

    expect(messageA).not.toBe(messageB);

    const result = decideCrossTurnLoopWarning({
      previousAssistantMessages: [messageA],
      reply: messageB,
      windowAssistantMessages: 3,
      similarityThreshold: 0.97,
      minChars: 120,
      cooldownAssistantMessages: 0,
    });

    expect(result).toEqual({ warn: false });
  });
});
