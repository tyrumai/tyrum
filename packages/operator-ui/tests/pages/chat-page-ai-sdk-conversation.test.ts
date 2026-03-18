// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { click, cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

const e = React.createElement;
const useChatMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const hydrateActiveSessionMock = vi.hoisted(() => vi.fn());
const testCore = {
  http: {},
  chatStore: {
    hydrateActiveSession: hydrateActiveSessionMock,
  },
} as unknown as OperatorCore;
const DRAFT_LINE_HEIGHT_PX = 20;
const DRAFT_PADDING_PX = 8;
const DRAFT_BORDER_PX = 1;
const DRAFT_MIN_HEIGHT_PX = DRAFT_LINE_HEIGHT_PX * 2 + DRAFT_PADDING_PX * 2 + DRAFT_BORDER_PX * 2;
const DRAFT_MAX_HEIGHT_PX = DRAFT_LINE_HEIGHT_PX * 12 + DRAFT_PADDING_PX * 2 + DRAFT_BORDER_PX * 2;

vi.mock("@ai-sdk/react", () => ({
  useChat: useChatMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("../../src/components/pages/chat-page-ai-sdk-messages.js", () => ({
  AiSdkChatMessageList: ({
    followRequestId,
    messages,
  }: {
    followRequestId: number;
    messages: UIMessage[];
  }) =>
    e(
      "div",
      {
        "data-follow-request-id": String(followRequestId),
        "data-testid": "mock-message-list",
      },
      String(messages.length),
    ),
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

function dispatchDraftKeyDown(draft: HTMLTextAreaElement, init: KeyboardEventInit): boolean {
  return draft.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

async function setDraftValue(draft: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    setNativeValue(draft, value);
    await Promise.resolve();
  });
}

function stubDraftSizing(): () => void {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  const computedStyleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const styles = originalGetComputedStyle(element);
    if (!(element instanceof HTMLTextAreaElement)) {
      return styles;
    }
    return {
      ...styles,
      lineHeight: `${DRAFT_LINE_HEIGHT_PX}px`,
      fontSize: "14px",
      paddingTop: `${DRAFT_PADDING_PX}px`,
      paddingBottom: `${DRAFT_PADDING_PX}px`,
      borderTopWidth: `${DRAFT_BORDER_PX}px`,
      borderBottomWidth: `${DRAFT_BORDER_PX}px`,
    } as CSSStyleDeclaration;
  });
  const scrollHeightSpy = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLTextAreaElement) {
      const lineCount = Math.max(this.value.split("\n").length, this.rows || 1);
      return lineCount * DRAFT_LINE_HEIGHT_PX + DRAFT_PADDING_PX * 2;
    });

  return () => {
    computedStyleSpy.mockRestore();
    scrollHeightSpy.mockRestore();
  };
}

describe("AiSdkConversation", () => {
  beforeEach(() => {
    useChatMock.mockReset();
    toastErrorMock.mockReset();
    hydrateActiveSessionMock.mockReset();
  });

  it("renders the session title in the header and falls back to New chat", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);
    const sessionClient = {
      get: vi.fn(async () => ({
        session_id: "session-1",
        messages: [],
      })),
    };

    const { AiSdkConversation } =
      await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
    const titledRoot = renderIntoDocument(
      e(AiSdkConversation, {
        approvalsById: {},
        core: testCore,
        onDelete: vi.fn(),
        onResolveApproval: vi.fn(),
        onRenderModeChange: vi.fn(),
        onSessionMessages: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId: vi.fn(async () => null),
        session: {
          session_id: "session-1",
          thread_id: "thread-1",
          title: "Visible chat title",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    expect(titledRoot.container.textContent).toContain("Visible chat title");
    expect(titledRoot.container.textContent).not.toContain("thread-1");

    cleanupTestRoot(titledRoot);

    const untitledRoot = renderIntoDocument(
      e(AiSdkConversation, {
        approvalsById: {},
        core: testCore,
        onDelete: vi.fn(),
        onResolveApproval: vi.fn(),
        onRenderModeChange: vi.fn(),
        onSessionMessages: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId: vi.fn(async () => null),
        session: {
          session_id: "session-2",
          thread_id: "thread-2",
          title: "",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    expect(untitledRoot.container.textContent).toContain("New chat");
    expect(untitledRoot.container.textContent).not.toContain("thread-2");

    cleanupTestRoot(untitledRoot);
  });

  it("sends messages and updates the markdown toggle", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const onDelete = vi.fn();
    const onRenderModeChange = vi.fn();
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
        core: testCore,
        onDelete,
        onResolveApproval: vi.fn(),
        onRenderModeChange,
        onSessionMessages,
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId,
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
    expect(
      testRoot.container
        .querySelector("[data-testid='mock-message-list']")
        ?.getAttribute("data-follow-request-id"),
    ).toBe("0");

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
    expect(
      testRoot.container
        .querySelector("[data-testid='mock-message-list']")
        ?.getAttribute("data-follow-request-id"),
    ).toBe("1");
    expect(draft.value).toBe("");

    const textToggle = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Text",
    );
    click(textToggle as HTMLElement);
    click(testRoot.container.querySelector("[data-testid='chat-delete']") as HTMLElement);

    expect(onRenderModeChange).toHaveBeenCalledWith("text");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(testRoot.container.textContent).not.toContain("expanded");
    expect(testRoot.container.textContent).not.toContain("collapsed");
    expect(testRoot.container.textContent).not.toContain("hidden");

    cleanupTestRoot(testRoot);
  });

  it("starts at two lines, auto-grows to twelve, and resets after send", async () => {
    const restoreSizing = stubDraftSizing();
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    const sessionClient = {
      get: vi.fn(async () => ({
        session_id: "session-1",
        messages: [],
      })),
    };

    try {
      const { AiSdkConversation } =
        await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
      testRoot = renderIntoDocument(
        e(AiSdkConversation, {
          approvalsById: {},
          core: testCore,
          onDelete: vi.fn(),
          onResolveApproval: vi.fn(),
          onRenderModeChange: vi.fn(),
          onSessionMessages: vi.fn(),
          renderMode: "markdown",
          resolvingApproval: null,
          resolveAttachedNodeId: vi.fn(async () => null),
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

      const draft = testRoot.container.querySelector(
        "[data-testid='ai-sdk-chat-draft']",
      ) as HTMLTextAreaElement;
      expect(draft.getAttribute("rows")).toBe("2");
      expect(draft.className).toContain("resize-none");
      expect(draft.style.height).toBe(`${DRAFT_MIN_HEIGHT_PX}px`);
      expect(draft.style.overflowY).toBe("hidden");

      await setDraftValue(draft, "line 1\nline 2\nline 3\nline 4");
      expect(draft.style.height).toBe(
        `${DRAFT_LINE_HEIGHT_PX * 4 + DRAFT_PADDING_PX * 2 + DRAFT_BORDER_PX * 2}px`,
      );
      expect(draft.style.overflowY).toBe("hidden");

      await setDraftValue(
        draft,
        Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join("\n"),
      );
      expect(draft.style.height).toBe(`${DRAFT_MAX_HEIGHT_PX}px`);
      expect(draft.style.overflowY).toBe("auto");

      click(testRoot.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement);
      await flushEffects();

      expect(chatState.sendMessage).toHaveBeenCalledOnce();
      expect(draft.value).toBe("");
      expect(draft.style.height).toBe(`${DRAFT_MIN_HEIGHT_PX}px`);
      expect(draft.style.overflowY).toBe("hidden");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      restoreSizing();
    }
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
    const reloadedSession = {
      session_id: "session-1",
      thread_id: "thread-1",
      title: "Generated title",
      messages: reloadedMessages,
    };
    const onSessionMessages = vi.fn();
    const sessionClient = {
      get: vi.fn(async () => reloadedSession),
    };

    const { AiSdkConversation } =
      await import("../../src/components/pages/chat-page-ai-sdk-conversation.js");
    const props = {
      approvalsById: {},
      core: testCore,
      onDelete: vi.fn(),
      onResolveApproval: vi.fn(),
      onRenderModeChange: vi.fn(),
      onSessionMessages,
      renderMode: "markdown" as const,
      resolvingApproval: null,
      resolveAttachedNodeId: vi.fn(async () => null),
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
    expect(hydrateActiveSessionMock).toHaveBeenCalledWith(reloadedSession);

    cleanupTestRoot(testRoot);
  });

  it("sends the draft on plain Enter", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const resolveAttachedNodeId = vi.fn(async () => null);
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
        core: testCore,
        onDelete: vi.fn(),
        onResolveApproval: vi.fn(),
        onRenderModeChange: vi.fn(),
        onSessionMessages: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId,
        session: {
          session_id: "session-1",
          thread_id: "thread-1",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    const draft = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    setNativeValue(draft, "hello world");

    let eventAllowed = true;
    act(() => {
      eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter" });
    });
    await flushEffects();

    expect(eventAllowed).toBe(false);
    expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
    expect(chatState.sendMessage).toHaveBeenCalledWith({ text: "hello world" }, undefined);
    expect(draft.value).toBe("");

    cleanupTestRoot(testRoot);
  });

  it("keeps Shift+Enter as a newline action", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

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
        core: testCore,
        onDelete: vi.fn(),
        onResolveApproval: vi.fn(),
        onRenderModeChange: vi.fn(),
        onSessionMessages: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId: vi.fn(async () => null),
        session: {
          session_id: "session-1",
          thread_id: "thread-1",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    const draft = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    setNativeValue(draft, "line 1\nline 2");

    let eventAllowed = true;
    act(() => {
      eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter", shiftKey: true });
    });
    await flushEffects();

    expect(eventAllowed).toBe(true);
    expect(chatState.sendMessage).not.toHaveBeenCalled();
    expect(draft.value).toBe("line 1\nline 2");

    cleanupTestRoot(testRoot);
  });

  it("does not send on Enter while composing IME input", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

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
        core: testCore,
        onDelete: vi.fn(),
        onResolveApproval: vi.fn(),
        onRenderModeChange: vi.fn(),
        onSessionMessages: vi.fn(),
        renderMode: "markdown",
        resolvingApproval: null,
        resolveAttachedNodeId: vi.fn(async () => null),
        session: {
          session_id: "session-1",
          thread_id: "thread-1",
          messages: [],
        },
        sessionClient,
        transport: { transport: true },
      } as never),
    );

    const draft = testRoot.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    setNativeValue(draft, "hello");

    let eventAllowed = true;
    act(() => {
      eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter", isComposing: true });
    });
    await flushEffects();

    expect(eventAllowed).toBe(true);
    expect(chatState.sendMessage).not.toHaveBeenCalled();
    expect(draft.value).toBe("hello");

    cleanupTestRoot(testRoot);
  });
});
