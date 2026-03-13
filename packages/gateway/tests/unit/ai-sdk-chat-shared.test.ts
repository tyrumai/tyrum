import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { resolveAuthoritativeTurnMessages } from "../../src/ws/protocol/ai-sdk-chat-shared.js";

describe("resolveAuthoritativeTurnMessages", () => {
  it("uses persisted history and appends only the submitted user message", async () => {
    const persistedMessages: UIMessage[] = [
      {
        id: "u-1",
        role: "user",
        parts: [{ type: "text", text: "Earlier user" }],
      },
      {
        id: "a-1",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier assistant" }],
      },
    ];
    const submittedMessages: UIMessage[] = [
      {
        id: "u-2",
        role: "user",
        parts: [{ type: "text", text: "Latest user" }],
      },
    ];

    const result = await resolveAuthoritativeTurnMessages({
      persistedMessages,
      submittedMessages,
      trigger: "submit-message",
    });

    expect(result.previousMessages).toEqual(persistedMessages);
    expect(result.originalMessages).toEqual([...persistedMessages, submittedMessages[0]]);
    expect(result.userText).toBe("Latest user");
  });

  it("reconstructs regenerate from persisted history without trusting submitted messages", async () => {
    const persistedMessages: UIMessage[] = [
      {
        id: "u-1",
        role: "user",
        parts: [{ type: "text", text: "Prompt" }],
      },
      {
        id: "a-1",
        role: "assistant",
        parts: [{ type: "text", text: "Old reply" }],
      },
    ];

    const result = await resolveAuthoritativeTurnMessages({
      persistedMessages,
      submittedMessages: [
        {
          id: "ignored",
          role: "user",
          parts: [{ type: "text", text: "Should be ignored" }],
        },
      ],
      trigger: "regenerate-message",
    });

    expect(result.previousMessages).toEqual([]);
    expect(result.originalMessages).toEqual([persistedMessages[0]]);
    expect(result.userText).toBe("Prompt");
  });
});
