// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createChatStore } from "../../../operator-core/src/stores/chat-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ChatPage } from "../../src/components/pages/chat-page.js";
import { cleanupTestRoot, click, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

function createApprovalsStoreStub() {
  const { store } = createStore({
    byId: {},
    pendingIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  return {
    ...store,
    resolve: vi.fn(async () => ({ approval: {} as never })),
  };
}

describe("ChatPage", () => {
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

    const approvalsStore = createApprovalsStoreStub();
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
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

    const approvalsStore = createApprovalsStoreStub();
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
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
    const approvalsStore = createApprovalsStoreStub();
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
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
    const composer = testRoot.container.querySelector<HTMLTextAreaElement>("textarea");
    const composerShell = composer?.closest<HTMLElement>("div.border-t");
    const composerRow = composer?.parentElement;
    const sendButton = composerRow?.querySelector<HTMLButtonElement>("button") ?? null;
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
    expect(transcript?.className).toContain("p-2");
    expect(composerShell?.className).toContain("p-2");
    expect(composerRow?.className).toContain("gap-2");
    expect(composer?.className).toContain("px-2.5");
    expect(composer?.className).toContain("py-2");
    expect(sendButton?.className).toContain("h-[44px]");
    expect(sendButton?.className).toContain("px-4");
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
    const approvalsStore = createApprovalsStoreStub();
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
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
    const approvalsStore = createApprovalsStoreStub();
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
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

  it("offers always approve for hydrated pending transcript approvals", async () => {
    const approvalId = "11111111-1111-1111-1111-111111111111";
    const resolve = vi.fn(async () => ({
      approval: {
        approval_id: approvalId,
        approval_key: "approval:1",
        kind: "workflow_step",
        status: "approved",
        prompt: "Approve execution of 'tool.automation.schedule.create' (risk=medium)",
        created_at: "2026-03-10T00:00:00.000Z",
        expires_at: null,
        resolution: {
          decision: "approved",
          resolved_at: "2026-03-10T00:00:01.000Z",
        },
      },
      createdOverrides: [],
    }));
    const approval = {
      approval_id: approvalId,
      approval_key: "approval:1",
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve execution of 'tool.automation.schedule.create' (risk=medium)",
      context: {
        policy: {
          suggested_overrides: [
            {
              tool_id: "tool.automation.schedule.create",
              pattern: "kind:heartbeat;execution:agent_turn;delivery:quiet",
              workspace_id: "22222222-2222-4222-8222-222222222222",
            },
          ],
        },
      },
      created_at: "2026-03-10T00:00:00.000Z",
      expires_at: null,
      resolution: null,
    } as const;
    const transcriptApproval = {
      kind: "approval",
      id: approvalId,
      approval_id: approvalId,
      status: "pending",
      title: "Approval required",
      detail: approval.prompt,
      created_at: approval.created_at,
      updated_at: approval.created_at,
    } as const;

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });
    const { store: approvalsBaseStore } = createStore({
      byId: { [approvalId]: approval },
      pendingIds: [approvalId],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });
    const approvalsStore = {
      ...approvalsBaseStore,
      resolve,
    };
    const { store: chatBaseStore } = createStore({
      agentId: "default",
      agents: {
        agents: [],
        loading: false,
        error: null,
      },
      sessions: {
        sessions: [],
        nextCursor: null,
        loading: false,
        error: null,
      },
      active: {
        sessionId: "session-1",
        session: {
          session_id: "session-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-thread-1",
          title: "Session",
          summary: "",
          transcript: [transcriptApproval],
          updated_at: approval.created_at,
          created_at: approval.created_at,
        },
        loading: false,
        typing: false,
        activeToolCallIds: [],
        error: null,
      },
      send: {
        sending: false,
        error: null,
      },
    });
    const chatStore = {
      ...chatBaseStore,
      setAgentId: vi.fn(),
      refreshAgents: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
      loadMoreSessions: vi.fn(async () => {}),
      openSession: vi.fn(async () => {}),
      newChat: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => {}),
      compactActive: vi.fn(async () => {}),
      deleteActive: vi.fn(async () => {}),
    };

    const matchMedia = stubMatchMedia("(min-width: 800px)", true);
    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(React.createElement(ChatPage, { core }));

    try {
      const alwaysButton = testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-${approvalId}"]`,
      );
      expect(alwaysButton).not.toBeNull();

      await act(async () => {
        click(alwaysButton!);
        await Promise.resolve();
      });
      const confirm = document.querySelector<HTMLButtonElement>(
        `[data-testid="approval-always-confirm-${approvalId}"]`,
      );
      expect(document.body.textContent ?? "").toContain(
        "Heartbeat schedule creation in this scope",
      );

      await act(async () => {
        click(confirm!);
        await Promise.resolve();
      });

      expect(resolve).toHaveBeenCalledWith({
        approvalId,
        decision: "approved",
        mode: "always",
        overrides: [
          {
            tool_id: "tool.automation.schedule.create",
            pattern: "kind:heartbeat;execution:agent_turn;delivery:quiet",
            workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      });
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });
});
