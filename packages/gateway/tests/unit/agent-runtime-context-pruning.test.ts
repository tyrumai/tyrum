import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { applyDeterministicContextCompactionAndToolPruning } from "../../src/modules/agent/runtime.js";

describe("AgentRuntime context pruning", () => {
  it("preserves instruction head messages when truncating", async () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys-a" },
      { role: "system", content: "sys-b" },
      { role: "user", content: [{ type: "text", text: "u-a" }] },
      { role: "user", content: [{ type: "text", text: "u-b" }] },
      ...Array.from({ length: 10 }, (_unused, index) => ({
        role: "assistant" as const,
        content: [{ type: "text" as const, text: `a-${index}` }],
      })),
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 8,
      tool_prune_keep_last_messages: 4,
    });
    expect(compacted).toHaveLength(8);
    expect(compacted[0]).toEqual(messages[0]);
    expect(compacted[1]).toEqual(messages[1]);
    expect(compacted[2]).toEqual(messages[2]);
    expect(compacted[3]).toEqual(messages[3]);
  });

  it("prunes older tool results even when message count is unlimited", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "read files" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc-1", toolName: "tool.fs.read", input: {} }],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "tool.fs.read",
            output: "FIRST_TOOL_OUTPUT_123",
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc-2", toolName: "tool.fs.read", input: {} }],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-2",
            toolName: "tool.fs.read",
            output: "SECOND_TOOL_OUTPUT_456",
          },
        ],
      } as unknown as ModelMessage,
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc-3", toolName: "tool.fs.read", input: {} }],
      } as unknown as ModelMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-3",
            toolName: "tool.fs.read",
            output: "THIRD_TOOL_OUTPUT_789",
          },
        ],
      } as unknown as ModelMessage,
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 0,
      tool_prune_keep_last_messages: 4,
    });
    const promptText = JSON.stringify(compacted);

    expect(promptText).not.toContain("FIRST_TOOL_OUTPUT_123");
    expect(promptText).toContain("SECOND_TOOL_OUTPUT_456");
    expect(promptText).toContain("THIRD_TOOL_OUTPUT_789");
  });
});
