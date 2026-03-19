// @vitest-environment jsdom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  dispatchDraftKeyDown,
  flushEffects,
  hydrateActiveSessionMock,
  mountConversation,
  setDraftValue,
  setInputFiles,
  stubDraftSizing,
  stubFileReader,
  useChatMock,
} from "./chat-page-ai-sdk-conversation.test-support.js";
import { cleanupTestRoot, click } from "../test-utils.js";

function draftHeightForLineCount(lineCount: number): number {
  const lineHeight = 20;
  const padding = 8;
  const border = 1;
  const minHeight = lineHeight * 2 + padding * 2 + border * 2;
  const maxHeight = lineHeight * 12 + padding * 2 + border * 2;
  const contentHeight = Math.max(1, lineCount) * lineHeight + padding * 2 + border * 2;
  return Math.min(maxHeight, Math.max(minHeight, contentHeight));
}

function makeUseChatState(
  overrides?: Partial<{
    error: null;
    messages: UIMessage[];
    sendMessage: ReturnType<typeof vi.fn>;
    setMessages: ReturnType<typeof vi.fn>;
    status: string;
  }>,
) {
  return {
    messages: [],
    status: "ready",
    error: null,
    sendMessage: vi.fn(async () => undefined),
    setMessages: vi.fn(),
    ...overrides,
  };
}

function makeSessionClient(messages: UIMessage[] = []) {
  return {
    get: vi.fn(async () => ({
      session_id: "session-1",
      messages,
    })),
  };
}

describe("AiSdkConversation", () => {
  beforeEach(() => {
    useChatMock.mockReset();
  });

  it("renders the session title in the header and falls back to New chat", async () => {
    useChatMock.mockReturnValue(makeUseChatState());

    const titled = await mountConversation({
      session: {
        session_id: "session-1",
        thread_id: "thread-1",
        title: "Visible chat title",
        messages: [],
      },
    });
    expect(titled.root.container.textContent).toContain("Visible chat title");
    expect(titled.root.container.textContent).not.toContain("thread-1");
    cleanupTestRoot(titled.root);

    const untitled = await mountConversation({
      session: {
        session_id: "session-2",
        thread_id: "thread-2",
        title: "",
        messages: [],
      },
    });
    expect(untitled.root.container.textContent).toContain("New chat");
    expect(untitled.root.container.textContent).not.toContain("thread-2");
    cleanupTestRoot(untitled.root);
  });

  it("sends messages and updates the markdown toggle", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const onDelete = vi.fn();
    const onRenderModeChange = vi.fn();
    const onSessionMessages = vi.fn();
    const resolveAttachedNodeId = vi.fn(async () => "node-1");

    const testRoot = await mountConversation({
      onDelete,
      onRenderModeChange,
      onSessionMessages,
      resolveAttachedNodeId,
      sessionClient: makeSessionClient(),
    });

    await flushEffects();
    expect(onSessionMessages).toHaveBeenCalledWith([]);
    expect(
      testRoot.root.container
        .querySelector("[data-testid='mock-message-list']")
        ?.getAttribute("data-follow-request-id"),
    ).toBe("0");
    expect(
      testRoot.root.container.querySelector("[data-testid='chat-conversation-panel']")?.className,
    ).toContain("min-w-0");

    const draft = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    await setDraftValue(draft, "hello world");
    click(testRoot.root.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement);
    await flushEffects();

    expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
    expect(chatState.sendMessage).toHaveBeenCalledWith(
      { text: "hello world" },
      { body: { attached_node_id: "node-1" } },
    );
    expect(
      testRoot.root.container
        .querySelector("[data-testid='mock-message-list']")
        ?.getAttribute("data-follow-request-id"),
    ).toBe("1");
    expect(draft.value).toBe("");

    click(
      Array.from(testRoot.root.container.querySelectorAll("button")).find(
        (button) => button.textContent === "Text",
      ) as HTMLElement,
    );
    click(testRoot.root.container.querySelector("[data-testid='chat-delete']") as HTMLElement);

    expect(onRenderModeChange).toHaveBeenCalledWith("text");
    expect(onDelete).toHaveBeenCalledOnce();
    expect(testRoot.root.container.textContent).not.toContain("expanded");
    expect(testRoot.root.container.textContent).not.toContain("collapsed");
    expect(testRoot.root.container.textContent).not.toContain("hidden");

    cleanupTestRoot(testRoot.root);
  });

  it("starts at two lines, auto-grows to twelve, and resets after send", async () => {
    const restoreSizing = stubDraftSizing();
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    try {
      const testRoot = await mountConversation();
      await flushEffects();

      const draft = testRoot.root.container.querySelector(
        "[data-testid='ai-sdk-chat-draft']",
      ) as HTMLTextAreaElement;
      expect(draft.getAttribute("rows")).toBe("2");
      expect(draft.className).toContain("resize-none");
      expect(draft.style.height).toBe(`${draftHeightForLineCount(2)}px`);
      expect(draft.style.overflowY).toBe("hidden");

      await setDraftValue(draft, "line 1\nline 2\nline 3\nline 4");
      expect(draft.style.height).toBe(`${draftHeightForLineCount(4)}px`);
      expect(draft.style.overflowY).toBe("hidden");

      await setDraftValue(
        draft,
        Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join("\n"),
      );
      expect(draft.style.height).toBe(`${draftHeightForLineCount(20)}px`);
      expect(draft.style.overflowY).toBe("auto");

      click(
        testRoot.root.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement,
      );
      await flushEffects();

      expect(chatState.sendMessage).toHaveBeenCalledOnce();
      expect(draft.value).toBe("");
      expect(draft.style.height).toBe(`${draftHeightForLineCount(2)}px`);
      expect(draft.style.overflowY).toBe("hidden");

      cleanupTestRoot(testRoot.root);
    } finally {
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

    const testRoot = await mountConversation({ onSessionMessages, sessionClient });
    await flushEffects();
    chatState.status = "ready";
    testRoot.rerender();
    await flushEffects();

    expect(sessionClient.get).toHaveBeenCalledWith({ session_id: "session-1" });
    expect(chatState.setMessages).toHaveBeenCalledWith(reloadedMessages);
    expect(hydrateActiveSessionMock).toHaveBeenCalledWith(reloadedSession);

    cleanupTestRoot(testRoot.root);
  });

  it("sends the draft on plain Enter", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const resolveAttachedNodeId = vi.fn(async () => null);
    const testRoot = await mountConversation({
      resolveAttachedNodeId,
      sessionClient: makeSessionClient(),
    });

    const draft = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    await setDraftValue(draft, "hello world");

    let eventAllowed = true;
    eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter" });
    await flushEffects();

    expect(eventAllowed).toBe(false);
    expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
    expect(chatState.sendMessage).toHaveBeenCalledWith({ text: "hello world" }, undefined);
    expect(draft.value).toBe("");

    cleanupTestRoot(testRoot.root);
  });

  it("sends text plus files and preserves attached-node metadata", async () => {
    const restoreFileReader = stubFileReader();
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const resolveAttachedNodeId = vi.fn(async () => "node-1");

    try {
      const testRoot = await mountConversation({
        resolveAttachedNodeId,
        sessionClient: makeSessionClient(),
      });

      const draft = testRoot.root.container.querySelector(
        "[data-testid='ai-sdk-chat-draft']",
      ) as HTMLTextAreaElement;
      const filesInput = testRoot.root.container.querySelector(
        "[data-testid='ai-sdk-chat-files']",
      ) as HTMLInputElement;
      const file = new File(["hello"], "diagram.png", { type: "image/png" });
      await setDraftValue(draft, "hello world");
      await act(async () => {
        setInputFiles(filesInput, [file]);
        click(
          testRoot.root.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement,
        );
        await Promise.resolve();
      });
      await flushEffects();

      expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
      expect(chatState.sendMessage).toHaveBeenCalledWith(
        {
          text: "hello world",
          files: [
            {
              type: "file",
              mediaType: "image/png",
              filename: "diagram.png",
              url: "data:image/png;base64,stub",
            },
          ],
        },
        { body: { attached_node_id: "node-1" } },
      );
      expect(draft.value).toBe("");
      expect(filesInput.value).toBe("");

      cleanupTestRoot(testRoot.root);
    } finally {
      restoreFileReader();
    }
  });

  it("sends file-only messages when the draft is empty", async () => {
    const restoreFileReader = stubFileReader();
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);

    const resolveAttachedNodeId = vi.fn(async () => null);

    try {
      const testRoot = await mountConversation({
        resolveAttachedNodeId,
        sessionClient: makeSessionClient(),
      });

      const draft = testRoot.root.container.querySelector(
        "[data-testid='ai-sdk-chat-draft']",
      ) as HTMLTextAreaElement;
      const filesInput = testRoot.root.container.querySelector(
        "[data-testid='ai-sdk-chat-files']",
      ) as HTMLInputElement;
      const file = new File(["pdf"], "notes.pdf", { type: "application/pdf" });
      await act(async () => {
        setInputFiles(filesInput, [file]);
        await Promise.resolve();
      });

      expect(draft.value).toBe("");
      await act(async () => {
        click(
          testRoot.root.container.querySelector("[data-testid='ai-sdk-chat-send']") as HTMLElement,
        );
        await Promise.resolve();
      });
      await flushEffects();

      expect(resolveAttachedNodeId).toHaveBeenCalledOnce();
      expect(chatState.sendMessage).toHaveBeenCalledWith(
        {
          files: [
            {
              type: "file",
              mediaType: "application/pdf",
              filename: "notes.pdf",
              url: "data:application/pdf;base64,stub",
            },
          ],
        },
        undefined,
      );
      expect(draft.value).toBe("");
      expect(filesInput.value).toBe("");

      cleanupTestRoot(testRoot.root);
    } finally {
      restoreFileReader();
    }
  });

  it("keeps Shift+Enter as a newline action", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);
    const testRoot = await mountConversation({ sessionClient: makeSessionClient() });

    const draft = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    await setDraftValue(draft, "line 1\nline 2");

    const eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter", shiftKey: true });
    await flushEffects();

    expect(eventAllowed).toBe(true);
    expect(chatState.sendMessage).not.toHaveBeenCalled();
    expect(draft.value).toBe("line 1\nline 2");

    cleanupTestRoot(testRoot.root);
  });

  it("does not send on Enter while composing IME input", async () => {
    const chatState = makeUseChatState();
    useChatMock.mockReturnValue(chatState);
    const testRoot = await mountConversation({ sessionClient: makeSessionClient() });

    const draft = testRoot.root.container.querySelector(
      "[data-testid='ai-sdk-chat-draft']",
    ) as HTMLTextAreaElement;
    await setDraftValue(draft, "hello");

    const eventAllowed = dispatchDraftKeyDown(draft, { key: "Enter", isComposing: true });
    await flushEffects();

    expect(eventAllowed).toBe(true);
    expect(chatState.sendMessage).not.toHaveBeenCalled();
    expect(draft.value).toBe("hello");

    cleanupTestRoot(testRoot.root);
  });
});
