// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { AiSdkChatPage } from "../../src/components/pages/chat-page-ai-sdk.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

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

describe("AiSdkChatPage", () => {
  it("shows a transport-unavailable state when the WS client lacks AI SDK chat hooks", () => {
    const { store: connectionStore } = createStore({
      status: "disconnected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });
    const approvalsStore = createApprovalsStoreStub();
    const { store: chatStoreBase } = createStore({
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
      archivedSessions: {
        sessions: [],
        nextCursor: null,
        loading: false,
        loaded: false,
        error: null,
      },
      active: {
        sessionId: null,
        session: null,
        loading: false,
        error: null,
      },
    });
    const chatStore = {
      ...chatStoreBase,
      setAgentId: vi.fn(),
      refreshAgents: vi.fn(async () => undefined),
      refreshSessions: vi.fn(async () => undefined),
      loadMoreSessions: vi.fn(async () => undefined),
      openSession: vi.fn(async () => undefined),
      hydrateActiveSession: vi.fn(),
      updateActiveMessages: vi.fn(),
      newChat: vi.fn(async () => undefined),
      deleteActive: vi.fn(async () => undefined),
      archiveSession: vi.fn(async () => undefined),
      unarchiveSession: vi.fn(async () => undefined),
      loadArchivedSessions: vi.fn(async () => undefined),
      loadMoreArchivedSessions: vi.fn(async () => undefined),
    };
    const core = {
      approvalsStore,
      chatStore,
      connectionStore,
      http: {
        agents: {
          list: vi.fn(),
        },
      },
      ws: {
        connected: false,
        off: vi.fn(),
        on: vi.fn(),
      },
    } as unknown as OperatorCore & {
      http: OperatorCore["admin"];
      ws: unknown;
    };
    core.admin = core.http;
    core.workboard = core.ws as OperatorCore["workboard"];
    core.chatSocket = core.ws as OperatorCore["chatSocket"];

    const testRoot = renderIntoDocument(React.createElement(AiSdkChatPage, { core }));

    expect(testRoot.container.textContent).toContain("Chat unavailable");
    expect(testRoot.container.textContent).toContain(
      "Chat is temporarily unavailable. Try reconnecting.",
    );

    cleanupTestRoot(testRoot);
  });
});
