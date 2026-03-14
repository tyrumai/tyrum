// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;
const testCore = { http: {} } as unknown as OperatorCore;

vi.mock("../../src/components/pages/chat-page-ai-sdk-message-card.js", () => ({
  MessageCard: ({ message }: { message: { id: string } }) =>
    e("div", { "data-testid": `mock-message-${message.id}` }, message.id),
}));

describe("AiSdkChatMessageList", () => {
  it("renders an empty state when there are no messages", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const testRoot = renderIntoDocument(
      e(AiSdkChatMessageList, {
        approvalsById: {},
        core: testCore,
        messages: [],
        onResolveApproval: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        working: false,
      }),
    );

    expect(testRoot.container.textContent).toContain("No messages yet.");

    cleanupTestRoot(testRoot);
  });

  it("renders message cards inside the transcript container", async () => {
    const { AiSdkChatMessageList } =
      await import("../../src/components/pages/chat-page-ai-sdk-messages.js");
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "reply" }],
      },
    ] as unknown as UIMessage[];
    const testRoot = renderIntoDocument(
      e(AiSdkChatMessageList, {
        approvalsById: {},
        core: testCore,
        messages,
        onResolveApproval: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        working: true,
      }),
    );

    const transcript = testRoot.container.querySelector("[data-testid='ai-sdk-chat-transcript']");
    expect(transcript).not.toBeNull();
    expect(
      testRoot.container.querySelector("[data-testid='mock-message-assistant-1']"),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });
});
