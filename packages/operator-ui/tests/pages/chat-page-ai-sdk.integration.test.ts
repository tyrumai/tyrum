// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createChatStore } from "../../../operator-core/src/stores/chat-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { click, cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const e = React.createElement;
const supportsSocketMock = vi.hoisted(() => vi.fn(() => true));
const createSessionClientMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ transport: true })));
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@tyrum/client", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatSessionClient: createSessionClientMock,
  createTyrumAiSdkChatTransport: createTransportMock,
}));

vi.mock("@tyrum/client/browser", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatSessionClient: createSessionClientMock,
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
    onNewChat,
    onOpenThread,
    threads,
  }: {
    onNewChat: () => void;
    onOpenThread: (sessionId: string) => void;
    threads: Array<{ preview: string; session_id: string; title: string }>;
  }) =>
    e(
      "div",
      { "data-testid": "mock-threads-panel" },
      e("button", { "data-testid": "mock-new-chat", onClick: onNewChat, type: "button" }, "new"),
      ...threads.map((thread) =>
        e(
          "button",
          {
            key: thread.session_id,
            "data-testid": `mock-open-${thread.session_id}`,
            onClick: () => {
              onOpenThread(thread.session_id);
            },
            type: "button",
          },
          `${thread.title}:${thread.preview}`,
        ),
      ),
    ),
}));

vi.mock("../../src/components/pages/chat-page-ai-sdk-conversation.js", () => ({
  AiSdkConversation: ({
    onDelete,
    onSessionMessages,
    session,
  }: {
    onDelete: () => void;
    onSessionMessages: (messages: UIMessage[]) => void;
    session: { session_id: string };
  }) =>
    e(
      "div",
      { "data-testid": "mock-conversation" },
      e("div", { "data-testid": "mock-session-id" }, session.session_id),
      e(
        "button",
        {
          "data-testid": "mock-conversation-messages",
          onClick: () => {
            onSessionMessages([
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

function createSessionSummary(sessionId: string, preview: string) {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `thread-${sessionId}`,
    title: `Title ${sessionId}`,
    created_at: "2026-03-13T00:00:00.000Z",
    updated_at: "2026-03-13T00:00:00.000Z",
    message_count: 1,
    last_message: { role: "assistant" as const, text: preview },
  };
}

function createSession(sessionId: string, preview: string) {
  return {
    ...createSessionSummary(sessionId, preview),
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

describe("AiSdkChatPage integration", () => {
  it("loads sessions, starts chats, applies message updates, and deletes sessions", async () => {
    const sessionClient = {
      list: vi.fn(async () => ({
        sessions: [createSessionSummary("session-1", "Existing preview")],
        next_cursor: null,
      })),
      get: vi.fn(async ({ session_id }: { session_id: string }) =>
        createSession(session_id, "Existing preview"),
      ),
      create: vi.fn(async () => createSession("session-2", "New preview")),
      delete: vi.fn(async () => undefined),
    };
    createSessionClientMock.mockReturnValue(sessionClient);

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
      http,
      ws,
    } as unknown as OperatorCore;

    const { AiSdkChatPage } = await import("../../src/components/pages/chat-page-ai-sdk.js");
    const testRoot = renderIntoDocument(e(AiSdkChatPage, { core }));

    await flushEffects();
    await flushEffects();

    expect(agentList).toHaveBeenCalledOnce();
    expect(sessionClient.list).toHaveBeenCalledWith({
      agent_id: "default",
      channel: "ui",
      limit: 50,
    });
    expect(sessionClient.get).toHaveBeenCalledWith({ session_id: "session-1" });
    expect(testRoot.container.textContent).toContain("session-1");
    expect(testRoot.container.textContent).toContain("Title session-1:Existing preview");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-new-chat']") as HTMLElement,
    );

    expect(sessionClient.create).toHaveBeenCalledWith({ agent_id: "default", channel: "ui" });
    expect(testRoot.container.textContent).toContain("session-2");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-conversation-messages']") as HTMLElement,
    );

    expect(testRoot.container.textContent).toContain("Title session-2:Fresh assistant reply");

    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-conversation-delete']") as HTMLElement,
    );
    await flushEffects();
    await clickAndFlush(
      testRoot.container.querySelector("[data-testid='mock-confirm-delete']") as HTMLElement,
    );
    await flushEffects();

    expect(sessionClient.delete).toHaveBeenCalledWith({ session_id: "session-2" });
    expect(testRoot.container.textContent).toContain("session-1");

    cleanupTestRoot(testRoot);
  });
});
