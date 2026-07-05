import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { createAiSdkChatLiveState } from "../../src/ws/protocol/ai-sdk-chat-live-state.js";

describe("ai-sdk chat live state", () => {
  it("stores non-transient data chunks as UI message parts", () => {
    const state = createAiSdkChatLiveState({
      createMessageId: () => "assistant-1",
      messages: [],
    });

    state.applyChunk({
      type: "data-approval-state",
      id: "approval-1",
      data: { state: "pending" },
      transient: true,
    } satisfies UIMessageChunk);
    state.applyChunk({
      type: "tool-approval-response",
      approvalId: "approval-1",
      approved: true,
    } satisfies UIMessageChunk);
    state.applyChunk({
      type: "custom",
      kind: "provider.event",
    } satisfies UIMessageChunk);
    state.applyChunk({
      type: "data-approval-state",
      id: "approval-1",
      data: { state: "pending" },
      transient: false,
    } satisfies UIMessageChunk);
    state.applyChunk({
      type: "data-approval-state",
      id: "approval-1",
      data: { state: "approved" },
    } satisfies UIMessageChunk);

    const messages = state.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      {
        type: "data-approval-state",
        id: "approval-1",
        data: { state: "approved" },
      },
    ]);
    expect(Object.prototype.hasOwnProperty.call(messages[0]?.parts[0], "transient")).toBe(false);
  });
});
