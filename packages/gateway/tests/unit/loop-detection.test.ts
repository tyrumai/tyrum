import { describe, expect, it } from "vitest";
import { detectWithinTurnToolLoop, signatureForToolStep } from "../../src/modules/agent/loop-detection.js";

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
