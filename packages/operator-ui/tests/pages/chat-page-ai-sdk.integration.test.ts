// @vitest-environment jsdom

import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createChatStore } from "../../../operator-app/src/stores/chat-store.js";
import { createStore } from "../../../operator-app/src/store.js";
import { click, cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;
const supportsSocketMock = vi.hoisted(() => vi.fn(() => true));
const createConversationClientMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ transport: true })));
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@tyrum/operator-app", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatConversationClient: createConversationClientMock,
  createTyrumAiSdkChatTransport: createTransportMock,
}));

vi.mock("@tyrum/transport-sdk", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatConversationClient: createConversationClientMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("../../src/components/layout/app-shell.js", () => ({
  useAppShellMinWidth: vi.fn(() => true),
}));

vi.mock("../../src/browser-node/browser-node-provider.js", () => ({
  useBrowserNodeOptional: vi.fn(() => null),
}));

vi.mock("../../src/host/host-api.js", () => ({
  useHostApiOptional: vi.fn(() => null),
}));

vi.mock("../../src/components/pages/chat-page-threads.js", () => ({
  ChatThreadsPanel: ({
    archivedThreads,
    onNewChat,
    onOpenThread,
    threads,
  }: {
    archivedThreads: Array<{ preview: string; conversation_id: string; title: string }>;
    onNewChat: () => void;
    onOpenThread: (conversationId: string) => void;
    threads: Array<{ preview: string; conversation_id: string; title: string }>;
  }) =>
    e(
      "div",
      { "data-testid": "mock-threads-panel" },
      e("button", { "data-testid": "mock-new-chat", onClick: onNewChat, type: "button" }, "new"),
      ...threads.map((thread) =>
        e(
          "button",
          {
            key: thread.conversation_id,
            "data-testid": `mock-open-${thread.conversation_id}`,
            onClick: () => {
              onOpenThread(thread.conversation_id);
            },
            type: "button",
          },
          `${thread.title}:${thread.preview}`,
        ),
      ),
      ...archivedThreads.map((thread) =>
        e(
          "button",
          {
            key: `archived-${thread.conversation_id}`,
            "data-testid": `mock-open-archived-${thread.conversation_id}`,
            onClick: () => {
              onOpenThread(thread.conversation_id);
            },
            type: "button",
          },
          `archived:${thread.title}:${thread.preview}`,
        ),
      ),
    ),
}));

vi.mock("../../src/components/pages/chat-page-ai-sdk-conversation.js", () => ({
  AiSdkConversation: ({
    onDelete,
    onConversationMessages,
    conversation,
  }: {
    onDelete: () => void;
    onConversationMessages: (messages: UIMessage[]) => void;
    conversation: { conversation_id: string };
  }) =>
    e(
      "div",
      { "data-testid": "mock-conversation" },
      e("div", { "data-testid": "mock-conversation-id" }, conversation.conversation_id),
      e(
        "button",
        {
          "data-testid": "mock-conversation-messages",
          onClick: () => {
            onConversationMessages([
              {
                id: "assistant-1",
                role: "assistant",
                parts: [{ type: "text", text: "Fresh assistant reply" }],
              } as unknown as UIMessage,
            ]);
          },
          type: "button",
        },
        "messages",
      ),
      e(
        "button",
        { "data-testid": "mock-conversation-delete", onClick: onDelete, type: "button" },
        "delete",
      ),
    ),
}));

vi.mock("../../src/components/ui/confirm-danger-dialog.js", () => ({
  ConfirmDangerDialog: ({ onConfirm, open }: { onConfirm: () => Promise<void>; open: boolean }) =>
    open
      ? e(
          "button",
          {
            "data-testid": "mock-confirm-delete",
            onClick: () => {
              void onConfirm();
            },
            type: "button",
          },
          "confirm",
        )
      : null,
}));

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

function createConversationSummary(conversationId: string, preview: string) {
  return {
    conversation_id: conversationId,
    agent_key: "default",
    channel: "ui",
    thread_id: `thread-${conversationId}`,
    title: `Title ${conversationId}`,
    created_at: "2026-03-13T00:00:00.000Z",
    updated_at: "2026-03-13T00:00:00.000Z",
    message_count: 1,
    last_message: { role: "assistant" as const, text: preview },
  };
}

function createConversation(conversationId: string, preview: string) {
  return {
    ...createConversationSummary(conversationId, preview),
    queue_mode: "steer" as const,
    messages: [],
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function clickAndFlush(element: HTMLElement): Promise<void> {
  await act(async () => {
    click(element);
    await Promise.resolve();
  });
}

function listThreadOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-testid^='mock-open-']")).map(
    (button) => button.getAttribute("data-testid")?.replace("mock-open-", "") ?? "",
  );
}

describe("AiSdkChatPage integration", () => {
  beforeEach(() => {
    createConversationClientMock.mockReset();
    createTransportMock.mockClear();
    toastErrorMock.mockReset();
    supportsSocketMock.mockReturnValue(true);
  });

  it("loads conversations, starts chats, applies message updates, and deletes conversations", async () => {
    const conversationClient = {
      list: vi.fn(async () => ({
        conversations: [createConversationSummary("conversation-1", "Existing preview")],
        next_cursor: null,
      })),
      get: vi.fn(async ({ conversation_id }: { conversation_id: string }) =>
        createConversation(conversation_id, "Existing preview"),
      ),
      create: vi.fn(async () => createConversation("conversation-2", "New preview")),
      delete: vi.fn(async () => undefined),
    };
    createConversationClientMock.mockReturnValue(conversationClient);

    const agentList = vi.fn(async () => ({
      agents: [
        { agent_key: "default", persona: { name: "Default" } },
        { agent_key: "other", persona: { name: "Other" } },
      ],
    }));
    const { store: connectionStore } = createStore({
      status: "connected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });
    const approvalsStore = createApprovalsStoreStub();
    const ws = {
      connected: true,
      off: vi.fn(),
      on: vi.fn(),
      requestDynamic: vi.fn(),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    };
    const http = {
      agentList: {
        get: agentList,
      },
    };
    const chatStore = createChatStore(ws as never, http as never);
    const core = {
      approvalsStore,
      chatStore,
      connectionStore,
      admin: http,
      http,
      chatSocket: ws,
      workboard: ws,
      ws,
    } as unknown as OperatorCore;

    const { AiSdkChatPage } = await import("../../src/components/pages/chat-page-ai-sdk.js");
    const testRoot = renderIntoDocument(e(AiSdkChatPage, { core }));

    await flushEffects();
    await flushEffects();

    expect(agentList).toHaveBeenCalledOnce();
    expect(conversationClient.list).toHaveBeenCalledWith({
      agent_key: "default",
      channel: "ui",
      limit: 50,
    });
    expect(conversationClient.get).toHaveBeenCalledWith({ conversation_id: "conversation-1" });
    expect(testRoot.container.textContent).toContain("conversation-1");
    expect(testRoot.container.textContent).toContain("Title conversation-1:Existing preview");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-new-chat']") as HTMLElement,
    );

    expect(conversationClient.create).toHaveBeenCalledWith({ agent_key: "default", channel: "ui" });
    expect(testRoot.container.textContent).toContain("conversation-2");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-conversation-messages']") as HTMLElement,
    );

    expect(testRoot.container.textContent).toContain("Title conversation-2:Fresh assistant reply");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-conversation-delete']") as HTMLElement,
    );
    await flushEffects();
    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-confirm-delete']") as HTMLElement,
    );
    await flushEffects();

    expect(conversationClient.delete).toHaveBeenCalledWith({ conversation_id: "conversation-2" });
    expect(testRoot.container.textContent).toContain("conversation-1");

    cleanupTestRoot(testRoot);
  });

  it("opens archived chats without unarchiving them first", async () => {
    const conversationClient = {
      list: vi.fn(async () => ({ conversations: [], next_cursor: null })),
      get: vi.fn(async ({ conversation_id }: { conversation_id: string }) =>
        createConversation(conversation_id, ""),
      ),
      create: vi.fn(async () => createConversation("conversation-2", "New preview")),
      delete: vi.fn(async () => undefined),
    };
    createConversationClientMock.mockReturnValue(conversationClient);

    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });
    const approvalsStore = createApprovalsStoreStub();
    const { store: chatStoreBase } = createStore({
      agentKey: "default",
      agents: {
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
        loading: false,
        error: null,
      },
      conversations: {
        conversations: [],
        nextCursor: null,
        loading: false,
        error: null,
      },
      archivedConversations: {
        conversations: [
          {
            ...createConversationSummary("conversation-archived", "Archived preview"),
            title: "",
            archived: true,
          },
        ],
        nextCursor: null,
        loading: false,
        loaded: true,
        error: null,
      },
      active: {
        conversationId: null,
        conversation: null,
        loading: false,
        error: null,
      },
    });
    const chatStore = {
      ...chatStoreBase,
      setAgentKey: vi.fn(),
      refreshAgents: vi.fn(async () => undefined),
      refreshConversations: vi.fn(async () => undefined),
      loadMoreConversations: vi.fn(async () => undefined),
      openConversation: vi.fn(async () => undefined),
      hydrateActiveConversation: vi.fn(),
      updateActiveMessages: vi.fn(),
      newChat: vi.fn(async () => undefined),
      deleteActive: vi.fn(async () => undefined),
      archiveConversation: vi.fn(async () => undefined),
      unarchiveConversation: vi.fn(async () => undefined),
      loadArchivedConversations: vi.fn(async () => undefined),
      loadMoreArchivedConversations: vi.fn(async () => undefined),
    };
    const ws = {
      connected: true,
      off: vi.fn(),
      on: vi.fn(),
      requestDynamic: vi.fn(),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    };
    const http = {
      agentList: {
        get: vi.fn(async () => ({ agents: [] })),
      },
    };
    const core = {
      approvalsStore,
      chatStore,
      connectionStore,
      admin: http,
      http,
      chatSocket: ws,
      workboard: ws,
      ws,
    } as unknown as OperatorCore;

    const { AiSdkChatPage } = await import("../../src/components/pages/chat-page-ai-sdk.js");
    const testRoot = renderIntoDocument(e(AiSdkChatPage, { core }));

    await flushEffects();
    await clickAndFlush(
      testRoot.container.querySelector(
        "[data-testid='mock-open-archived-conversation-archived']",
      ) as HTMLElement,
    );

    expect(chatStore.openConversation).toHaveBeenCalledWith("conversation-archived");
    expect(chatStore.unarchiveConversation).not.toHaveBeenCalled();

    cleanupTestRoot(testRoot);
  });

  it("keeps thread order stable when opening an older thread and promotes on real updates", async () => {
    const conversationClient = {
      list: vi.fn(async () => ({
        conversations: [
          createConversationSummary("conversation-1", "Newest preview"),
          {
            ...createConversationSummary("conversation-2", "Older preview"),
            created_at: "2026-03-12T00:00:00.000Z",
            updated_at: "2026-03-12T00:00:00.000Z",
          },
        ],
        next_cursor: null,
      })),
      get: vi.fn(async ({ conversation_id }: { conversation_id: string }) =>
        conversation_id === "conversation-2"
          ? {
              ...createConversation("conversation-2", "Older preview"),
              created_at: "2026-03-12T00:00:00.000Z",
              updated_at: "2026-03-12T00:00:00.000Z",
            }
          : createConversation("conversation-1", "Newest preview"),
      ),
      create: vi.fn(async () => createConversation("conversation-3", "New preview")),
      delete: vi.fn(async () => undefined),
    };
    createConversationClientMock.mockReturnValue(conversationClient);

    const agentList = vi.fn(async () => ({
      agents: [{ agent_key: "default", persona: { name: "Default" } }],
    }));
    const { store: connectionStore } = createStore({
      status: "connected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });
    const approvalsStore = createApprovalsStoreStub();
    const ws = {
      connected: true,
      off: vi.fn(),
      on: vi.fn(),
      requestDynamic: vi.fn(),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    };
    const http = {
      agentList: {
        get: agentList,
      },
    };
    const chatStore = createChatStore(ws as never, http as never);
    const core = {
      approvalsStore,
      chatStore,
      connectionStore,
      admin: http,
      http,
      chatSocket: ws,
      workboard: ws,
      ws,
    } as unknown as OperatorCore;

    const { AiSdkChatPage } = await import("../../src/components/pages/chat-page-ai-sdk.js");
    const testRoot = renderIntoDocument(e(AiSdkChatPage, { core }));

    await flushEffects();
    await flushEffects();

    expect(agentList).toHaveBeenCalledOnce();
    expect(conversationClient.get).toHaveBeenCalledWith({ conversation_id: "conversation-1" });
    expect(listThreadOrder(testRoot.container)).toEqual(["conversation-1", "conversation-2"]);

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-open-conversation-2']") as HTMLElement,
    );

    expect(conversationClient.get).toHaveBeenLastCalledWith({ conversation_id: "conversation-2" });
    expect(listThreadOrder(testRoot.container)).toEqual(["conversation-1", "conversation-2"]);
    expect(testRoot.container.textContent).toContain("conversation-2");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-conversation-messages']") as HTMLElement,
    );

    expect(listThreadOrder(testRoot.container)).toEqual(["conversation-2", "conversation-1"]);
    expect(testRoot.container.textContent).toContain("Title conversation-2:Fresh assistant reply");

    cleanupTestRoot(testRoot);
  });
});
