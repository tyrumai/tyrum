// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { click, cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

const e = React.createElement;
const useChatMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: useChatMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("../../src/components/pages/chat-page-ai-sdk-messages.js", () => ({
  AiSdkChatMessageList: ({ messages }: { messages: UIMessage[] }) =>
    e("div", { "data-testid": "mock-message-list" }, String(messages.length)),
}));

function makeUseChatState(overrides?: Partial<ReturnType<typeof useChatMock>>) {
  return {
    messages: [],
    status: "ready",
    error: null,
    sendMessage: vi.fn(async () => undefined),
    setMessages: vi.fn(),
    ...overrides,
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AiSdkConversation", () => {
  beforeEach(() => {
    useChatMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("sends messages and updates render toggles", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const onDelete = vi.fn();
    const onRenderModeChange = vi.fn();
    const onReasoningModeChange = vi.fn();
    const onSessionMessages = vi.fn();
    const resolveAttachedNodeId = vi.fn(async () => "node-1");
    const sessionClient = {
      get: vi.fn(async () => ({
        session_id: "session-1",
        messages: [],
      })),
    };

    const { AiSdkConversation } =
      await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
    const testRoot = renderIntoDocument(
      e(AiSdkConversation, {
        approvalsById: {},
        onDelete,
        onResolveApproval: vi.fn(),
        onRenderModeChange,
        onReasoningModeChange,
        onSessionMessages,
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId,
        reasoningMode: "collapsed",
        session: {
          session_id: "session-1",
          thread_id: "thread-1",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    await flushEffects();
    expect(onSessionMessages).toHaveBeenCalledWith([]);

    const conversationPanel = testRoot.container.querySelector(
      "[data-testid='chat-conversation-panel']",
    ) as HTMLElement | null;
    expect(conversationPanel?.className).toContain("min-w-0");

    const draft = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    setNativeValue(draft, "hello world");
    click(testRoot.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement);
    await flushEffects();

    expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
    expect(chatState.sendMessage).toHaveBeenCalledWith(
      { text: "hello world" },
      { body: { attached_node_id: "node-1" } },
    );
    expect(draft.value).toBe("");

    const textToggle = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Text",
    );
    const expandedToggle = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent === "expanded",
    );
    click(textToggle as HTMLElement);
    click(expandedToggle as HTMLElement);
    click(testRoot.container.querySelector("[data-testid='chat-delete']") as HTMLElement);

    expect(onRenderModeChange).toHaveBeenCalledWith("text");
    expect(onReasoningModeChange).toHaveBeenCalledWith("expanded");
    expect(onDelete).toHaveBeenCalledOnce();

    cleanupTestRoot(testRoot);
  });

  it("reloads session messages after streaming completes", async () => {
    const chatState = makeUseChatState({ status: "streaming" });
    useChatMock.mockImplementation(() => chatState);

    const reloadedMessages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
      },
    ] as unknown as UIMessage[];
    const onSessionMessages = vi.fn();
    const sessionClient = {
      get: vi.fn(async () => ({
        session_id: "session-1",
        messages: reloadedMessages,
      })),
    };

    const { AiSdkConversation } =
      await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
    const props = {
      approvalsById: {},
      onDelete: vi.fn(),
      onResolveApproval: vi.fn(),
      onRenderModeChange: vi.fn(),
      onReasoningModeChange: vi.fn(),
      onSessionMessages,
      renderMode: "markdown" as const,
      resolvingApproval: null,
      resolveAttachedNodeId: vi.fn(async () => null),
      reasoningMode: "collapsed" as const,
      session: {
        session_id: "session-1",
        thread_id: "thread-1",
        messages: [],
      },
      sessionClient,
      transport: { transport: true },
    };
    const testRoot = renderIntoDocument(e(AiSdkConversation, props as never));

    await flushEffects();
    chatState.status = "ready";
    act(() => {
      testRoot.root.render(e(AiSdkConversation, props as never));
    });
    await flushEffects();

    expect(sessionClient.get).toHaveBeenCalledWith({ session_id: "session-1" });
    expect(chatState.setMessages).toHaveBeenCalledWith(reloadedMessages);
    expect(onSessionMessages).toHaveBeenCalledWith(reloadedMessages);

    cleanupTestRoot(testRoot);
  });
});
