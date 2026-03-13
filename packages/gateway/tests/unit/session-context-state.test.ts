import { describe, expect, it } from "vitest";
import {
  buildPromptVisibleMessages,
  collectPendingToolStates,
} from "../../src/modules/agent/runtime/session-context-state.js";

describe("collectPendingToolStates", () => {
  it("prefers the toolName field over the part type suffix", () => {
    const states = collectPendingToolStates([
      {
        id: "msg-1",
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolCallId: "tc-1",
            toolName: "readFile",
            state: "running",
          },
        ],
      },
    ] as never);

    expect(states).toEqual([
      {
        summary: "running",
        tool_call_id: "tc-1",
        tool_name: "readFile",
      },
    ]);
  });
});

describe("buildPromptVisibleMessages", () => {
  it("includes pending tool state with the real tool name in the injected checkpoint message", () => {
    const messages = buildPromptVisibleMessages(
      [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "tool-invocation",
              toolCallId: "tc-1",
              toolName: "readFile",
              state: "running",
            },
          ],
        },
      ] as never,
      {
        version: 1,
        recent_message_ids: ["msg-1"],
        checkpoint: null,
        pending_approvals: [],
        pending_tool_state: [
          {
            tool_call_id: "tc-1",
            tool_name: "readFile",
            summary: "running",
          },
        ],
        updated_at: "2026-03-13T00:00:00.000Z",
      },
    );

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("readFile (tc-1): running"),
    });
  });
});
