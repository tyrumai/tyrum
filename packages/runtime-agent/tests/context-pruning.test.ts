import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { applyDeterministicContextCompactionAndToolPruning } from "../src/index.ts";

function makeToolCallMessage(id: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: id, toolName: "tool.fs.read", input: {} }],
  } as unknown as ModelMessage;
}

function makeToolResultMessage(id: string, output: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "tool.fs.read",
        output,
      },
    ],
  } as unknown as ModelMessage;
}

describe("@tyrum/runtime-agent context pruning", () => {
  it("preserves instruction head messages when truncating", () => {
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
    expect(compacted.slice(0, 4)).toEqual(messages.slice(0, 4));
  });

  it("prunes older tool results even when message count is unlimited", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "read files" }] },
      makeToolCallMessage("tc-1"),
      makeToolResultMessage("tc-1", "FIRST_TOOL_OUTPUT_123"),
      makeToolCallMessage("tc-2"),
      makeToolResultMessage("tc-2", "SECOND_TOOL_OUTPUT_456"),
      makeToolCallMessage("tc-3"),
      makeToolResultMessage("tc-3", "THIRD_TOOL_OUTPUT_789"),
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

  it("normalizes max_messages to at least eight", () => {
    const messages = Array.from({ length: 10 }, (_unused, index) => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `msg-${index}` }],
    }));

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 1,
      tool_prune_keep_last_messages: 4,
    });

    expect(compacted).toHaveLength(8);
  });

  it("normalizes tool_prune_keep_last_messages to at least two", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "read files" }] },
      makeToolCallMessage("tc-1"),
      makeToolResultMessage("tc-1", "FIRST_TOOL_OUTPUT_123"),
      makeToolCallMessage("tc-2"),
      makeToolResultMessage("tc-2", "SECOND_TOOL_OUTPUT_456"),
      makeToolCallMessage("tc-3"),
      makeToolResultMessage("tc-3", "THIRD_TOOL_OUTPUT_789"),
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 0,
      tool_prune_keep_last_messages: 1,
    });
    const normalized = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 0,
      tool_prune_keep_last_messages: 2,
    });

    expect(compacted).toEqual(normalized);
  });

  it("returns empty output when pruning removes all messages", () => {
    const compacted = applyDeterministicContextCompactionAndToolPruning(
      [{ role: "user", content: "" }],
      {
        max_messages: 8,
        tool_prune_keep_last_messages: 4,
      },
    );

    expect(compacted).toEqual([]);
  });

  it("returns early when the pruned output already fits within max_messages", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "done" },
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 8,
      tool_prune_keep_last_messages: 4,
    });

    expect(compacted).toEqual(messages);
  });

  it("keeps the first assistant message when truncation starts with assistant output", () => {
    const messages = Array.from({ length: 11 }, (_unused, index) => ({
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `assistant-${index}` }],
    }));

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 8,
      tool_prune_keep_last_messages: 4,
    });

    expect(compacted).toHaveLength(8);
    expect(compacted[0]).toEqual(messages[0]);
  });

  it("returns the instruction head when it already fills the message budget", () => {
    const messages: ModelMessage[] = [
      ...Array.from({ length: 8 }, (_unused, index) => ({
        role: "system" as const,
        content: `system-${index}`,
      })),
      { role: "assistant", content: "assistant-1" },
      { role: "assistant", content: "assistant-2" },
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 4,
      tool_prune_keep_last_messages: 4,
    });

    expect(compacted).toEqual(messages.slice(0, 8));
  });

  it("skips leading tool messages from the retained tail window", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      makeToolCallMessage("tc-1"),
      makeToolResultMessage("tc-1", "FIRST_TOOL_OUTPUT_123"),
      makeToolCallMessage("tc-2"),
      makeToolResultMessage("tc-2", "SECOND_TOOL_OUTPUT_456"),
      { role: "assistant", content: "tail-1" },
      { role: "assistant", content: "tail-2" },
      { role: "assistant", content: "tail-3" },
    ];

    const compacted = applyDeterministicContextCompactionAndToolPruning(messages, {
      max_messages: 8,
      tool_prune_keep_last_messages: 4,
    });
    const promptText = JSON.stringify(compacted);

    expect(promptText).not.toContain("FIRST_TOOL_OUTPUT_123");
    expect(promptText).toContain("SECOND_TOOL_OUTPUT_456");
    expect(compacted[2]?.role).not.toBe("tool");
  });
});
