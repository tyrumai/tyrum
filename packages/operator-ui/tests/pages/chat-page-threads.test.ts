// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatThreadsPanel } from "../../src/components/pages/chat-page-threads.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;

const archivedDefaults = {
  archivedThreads: [],
  archivedLoading: false,
  archivedLoaded: false,
  archivedHasError: false,
  canLoadMoreArchived: false,
  onArchiveThread: vi.fn(),
  onUnarchiveThread: vi.fn(),
  onLoadArchived: vi.fn(),
  onLoadMoreArchived: vi.fn(),
};

describe("ChatThreadsPanel", () => {
  it("renders agent names in the selector while keeping agent ids as option values", () => {
    const testRoot = renderIntoDocument(
      e(ChatThreadsPanel, {
        splitView: true,
        connected: true,
        loading: false,
        agentsLoading: false,
        errorMessage: null,
        threads: [],
        activeSessionId: null,
        onRefresh: vi.fn(),
        onLoadMore: vi.fn(),
        canLoadMore: false,
        onOpenThread: vi.fn(),
        agentId: "writer-agent",
        agents: [
          { agent_id: "writer-agent", label: "Writer (writer)" },
          { agent_id: "reviewer-agent", label: "Reviewer (reviewer)" },
        ],
        onAgentChange: vi.fn(),
        onNewChat: vi.fn(),
        ...archivedDefaults,
      }),
    );

    const select = testRoot.container.querySelector(
      "[data-testid='chat-agent-select']",
    ) as HTMLSelectElement | null;
    const options = Array.from(select?.querySelectorAll("option") ?? []);

    expect(options.map((option) => option.value)).toEqual(["writer-agent", "reviewer-agent"]);
    expect(options.map((option) => option.textContent)).toEqual([
      "Writer (writer)",
      "Reviewer (reviewer)",
    ]);

    cleanupTestRoot(testRoot);
  });

  it("renders a clear empty-state action to start a chat", () => {
    const onNewChat = vi.fn();
    const testRoot = renderIntoDocument(
      e(ChatThreadsPanel, {
        splitView: true,
        connected: true,
        loading: false,
        agentsLoading: false,
        errorMessage: null,
        threads: [],
        activeSessionId: null,
        onRefresh: vi.fn(),
        onLoadMore: vi.fn(),
        canLoadMore: false,
        onOpenThread: vi.fn(),
        agentId: "default",
        agents: [{ agent_id: "default", label: "Default" }],
        onAgentChange: vi.fn(),
        onNewChat,
        ...archivedDefaults,
      }),
    );

    const button = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-empty-threads-new"]',
    );
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Start new chat");

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewChat).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });

  it("shows an attachment label when a thread has messages but no text preview", () => {
    const testRoot = renderIntoDocument(
      e(ChatThreadsPanel, {
        splitView: true,
        connected: true,
        loading: false,
        agentsLoading: false,
        errorMessage: null,
        threads: [
          {
            agent_id: "default",
            session_id: "session-1",
            channel: "ui",
            thread_id: "thread-1",
            title: "Attachment thread",
            created_at: "2026-03-13T00:00:00.000Z",
            updated_at: "2026-03-14T00:00:00.000Z",
            message_count: 2,
            preview: "",
            archived: false,
          },
        ],
        activeSessionId: null,
        onRefresh: vi.fn(),
        onLoadMore: vi.fn(),
        canLoadMore: false,
        onOpenThread: vi.fn(),
        agentId: "default",
        agents: [{ agent_id: "default", label: "Default" }],
        onAgentChange: vi.fn(),
        onNewChat: vi.fn(),
        ...archivedDefaults,
      }),
    );

    expect(testRoot.container.textContent).toContain("Attachment");
    cleanupTestRoot(testRoot);
  });
});
