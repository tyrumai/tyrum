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
});
