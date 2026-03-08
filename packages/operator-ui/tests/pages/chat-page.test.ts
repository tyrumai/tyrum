// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createChatStore } from "../../../operator-core/src/stores/chat-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ChatPage } from "../../src/components/pages/chat-page.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

describe("ChatPage", () => {
  it("derives thread titles from the last turn even when the last turn is assistant", async () => {
    const ws = {
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            summary: "",
            last_turn: { role: "assistant", content: "Assistant title\nMore details" },
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
    expect(title?.textContent?.trim()).toBe("Assistant title");

    cleanupTestRoot(testRoot);
  });

  it("uses the session summary as preview when available", async () => {
    const ws = {
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            summary: "Conversation summary",
            last_turn: { role: "assistant", content: "Assistant title\nMore details" },
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

    const preview = threadButton?.querySelector<HTMLDivElement>("div.mt-1.text-xs");
    expect(preview?.textContent?.trim()).toBe("Conversation summary");

    cleanupTestRoot(testRoot);
  });

  it("uses a desktop split pane at large breakpoints", async () => {
    const ws = {
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            summary: "Conversation summary",
            last_turn: { role: "assistant", content: "Assistant title\nMore details" },
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

    const matchMedia = stubMatchMedia("(min-width: 1024px)", true);
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
    expect(page?.className).toContain("min-h-0");
    expect(panels?.className).toContain("flex-1");
    expect(panels?.className).toContain("lg:grid-cols-[19rem_minmax(0,1fr)]");
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

  it("uses master-detail navigation on narrow screens", async () => {
    const ws = {
      sessionList: vi.fn().mockResolvedValue({
        sessions: [
          {
            agent_id: "default",
            session_id: "ui:thread-1",
            channel: "ui",
            thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
            summary: "Conversation summary",
            last_turn: { role: "assistant", content: "Assistant title\nMore details" },
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
          summary: "Conversation summary",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          turns: [{ role: "assistant", content: "Loaded transcript" }],
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

    const matchMedia = stubMatchMedia("(min-width: 1024px)", false);
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
