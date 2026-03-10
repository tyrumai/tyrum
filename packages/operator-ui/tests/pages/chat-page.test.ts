// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createChatStore } from "../../../operator-core/src/stores/chat-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ChatPage } from "../../src/components/pages/chat-page.js";
import { ChatConversationPanel } from "../../src/components/pages/chat-page-parts.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

describe("ChatPage", () => {
  it("fades in the transcript copy button on hover", () => {
    const testRoot = renderIntoDocument(
      React.createElement(ChatConversationPanel, {
        activeThreadId: "thread-1",
        transcript: [
          {
            kind: "text",
            id: "turn-1",
            role: "assistant",
            content: "Copied text",
            created_at: new Date().toISOString(),
          },
        ],
        renderMode: "markdown",
        onRenderModeChange: () => {},
        loadError: null,
        sendError: null,
        deleteDisabled: false,
        onDelete: () => {},
        draft: "",
        setDraft: () => {},
        send: async () => {},
        sendBusy: false,
        canSend: false,
        working: false,
        onResolveApproval: () => {},
        resolvingApprovalId: null,
      }),
    );

    const copyButton = testRoot.container.querySelector<HTMLButtonElement>(
      'button[title="Copy message"]',
    );

    expect(copyButton).not.toBeNull();
    expect(copyButton?.className).toContain("opacity-0");
    expect(copyButton?.className).toContain("group-hover:opacity-100");
    expect(copyButton?.className).toContain("transition-opacity");

    cleanupTestRoot(testRoot);
  });

  it("uses the persisted session title instead of deriving it from the last turn", async () => {
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            title: "Persisted title",
            summary: "",
            transcript_count: 1,
            last_text: { role: "assistant", content: "Assistant title\nMore details" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }),
    };

    const chatStore = createChatStore(ws as never, {} as never);
    await chatStore.refreshSessions();

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    const threadButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-thread-ui:thread-1"]',
    );
    expect(threadButton).not.toBeNull();

    const title = threadButton?.querySelector<HTMLDivElement>("div.text-sm.font-medium");
    expect(title?.textContent?.trim()).toBe("Persisted title");

    cleanupTestRoot(testRoot);
  });

  it("uses the session summary as preview when available", async () => {
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            title: "Persisted title",
            summary: "Conversation summary",
            transcript_count: 1,
            last_text: { role: "assistant", content: "Assistant title\nMore details" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }),
    };

    const chatStore = createChatStore(ws as never, {} as never);
    await chatStore.refreshSessions();

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    const threadButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-thread-ui:thread-1"]',
    );
    expect(threadButton).not.toBeNull();

    const preview = threadButton?.querySelector<HTMLDivElement>("div.mt-0\\.5.truncate.text-xs");
    expect(preview?.textContent?.trim()).toBe("Conversation summary");

    cleanupTestRoot(testRoot);
  });

  it("uses a desktop split pane at large breakpoints", async () => {
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            title: "Persisted title",
            summary: "Conversation summary",
            transcript_count: 1,
            last_text: { role: "assistant", content: "Assistant title\nMore details" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }),
    };

    const chatStore = createChatStore(ws as never, {} as never);
    await chatStore.refreshSessions();

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const matchMedia = stubMatchMedia("(min-width: 800px)", true);
    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    const page = testRoot.container.querySelector<HTMLElement>('[data-testid="chat-page"]');
    const panels = testRoot.container.querySelector<HTMLElement>('[data-testid="chat-panels"]');
    const threadsPanel = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="chat-threads-panel"]',
    );
    const conversationPanel = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="chat-conversation-panel"]',
    );
    const transcript = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="chat-transcript"]',
    );
    const threadsScrollArea = threadsPanel?.querySelector<HTMLElement>("[data-scroll-area-root]");

    expect(page?.className).toContain("h-full");
    expect(page?.className).toContain("flex-1");
    expect(panels?.className).toContain("flex-1");
    expect(panels?.className).toContain("min-h-0");
    expect(panels?.className).toContain("w-full");
    expect(threadsPanel?.className).toContain("h-full");
    expect(threadsPanel?.className).toContain("min-h-0");
    expect(conversationPanel?.className).toContain("h-full");
    expect(conversationPanel?.className).toContain("min-h-0");
    expect(threadsScrollArea?.parentElement?.className).toContain("min-h-0");
    expect(threadsScrollArea?.parentElement?.className).toContain("flex-1");
    expect(transcript?.parentElement?.className).toContain("min-h-0");
    expect(transcript?.parentElement?.className).toContain("flex-1");
    expect(testRoot.container.querySelector('[data-testid="chat-delete"]')).not.toBeNull();

    matchMedia.cleanup();
    cleanupTestRoot(testRoot);
  });

  it("keeps the agents error alert positioned within the chat page", async () => {
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      sessionList: vi.fn().mockResolvedValue({
        sessions: [],
        next_cursor: null,
      }),
    };
    const http = {
      agentList: {
        get: vi.fn().mockRejectedValue(new Error("agent list failed")),
      },
    };

    const chatStore = createChatStore(ws as never, http as never);
    const { store: connectionStore } = createStore({
      status: "connected",
      clientId: "client-1",
      lastDisconnect: null,
      transportError: null,
    });

    const matchMedia = stubMatchMedia("(min-width: 800px)", true);
    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const page = testRoot.container.querySelector<HTMLElement>('[data-testid="chat-page"]');
    const alerts = Array.from(testRoot.container.querySelectorAll<HTMLElement>('[role="alert"]'));
    const agentErrorAlert = alerts.find((alert) =>
      alert.textContent?.includes("Failed to load agents"),
    );

    expect(page?.className).toContain("relative");
    expect(agentErrorAlert?.textContent).toContain("agent list failed");

    matchMedia.cleanup();
    cleanupTestRoot(testRoot);
  });

  it("uses master-detail navigation on narrow screens", async () => {
    const ws = {
      on: vi.fn(),
      off: vi.fn(),
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            title: "Persisted title",
            summary: "Conversation summary",
            transcript_count: 1,
            last_text: { role: "assistant", content: "Assistant title\nMore details" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      }),
      sessionGet: vi.fn().mockResolvedValue({
        session: {
          agent_id: "default",
          session_id: "ui:thread-1",
          channel: "ui",
          thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
          title: "Persisted title",
          summary: "Conversation summary",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          transcript: [
            {
              kind: "text",
              id: "turn-1",
              role: "assistant",
              content: "Loaded transcript",
              created_at: new Date().toISOString(),
            },
          ],
        },
      }),
    };

    const chatStore = createChatStore(ws as never, {} as never);
    await chatStore.refreshSessions();

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const matchMedia = stubMatchMedia("(min-width: 800px)", false);
    const core = { connectionStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    expect(testRoot.container.querySelector('[data-testid="chat-threads-panel"]')).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="chat-conversation-panel"]')).toBeNull();

    const threadButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-thread-ui:thread-1"]',
    );
    expect(threadButton).not.toBeNull();

    await act(async () => {
      threadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testRoot.container.querySelector('[data-testid="chat-threads-panel"]')).toBeNull();
    expect(
      testRoot.container.querySelector('[data-testid="chat-conversation-panel"]'),
    ).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="chat-back"]')).not.toBeNull();

    matchMedia.cleanup();
    cleanupTestRoot(testRoot);
  });
});
