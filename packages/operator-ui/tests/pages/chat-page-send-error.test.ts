// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ChatPage } from "../../src/components/pages/chat-page.js";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import {
  cleanupTestRoot,
  click,
  renderIntoDocument,
  setNativeValue,
  stubMatchMedia,
} from "../test-utils.js";

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

describe("ChatPage send errors", () => {
  it("does not overwrite newer composer input when send fails", async () => {
    let resolveStatus!: (value: {
      status: string;
      connected: boolean;
      deviceId: string | null;
    }) => void;
    const statusPromise = new Promise<{
      status: string;
      connected: boolean;
      deviceId: string | null;
    }>((resolve) => {
      resolveStatus = resolve;
    });

    const { store: connectionStore } = createStore({
      status: "connected",
      clientId: "client-1",
      lastDisconnect: null,
      transportError: null,
    });
    const approvalsStore = createApprovalsStoreStub();
    const { store: chatStoreBase, setState: setChatState } = createStore({
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
          transcript: [],
          updated_at: "2026-03-10T00:00:00.000Z",
          created_at: "2026-03-10T00:00:00.000Z",
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
    const sendMessage = vi.fn(async (_content: string) => {
      setChatState((prev) => ({
        ...prev,
        send: { sending: true, error: null },
      }));
      await Promise.resolve();
      setChatState((prev) => ({
        ...prev,
        send: {
          sending: false,
          error: {
            kind: "ws" as const,
            operation: "session.send",
            code: null,
            message: "send failed",
          },
        },
      }));
    });
    const chatStore = {
      ...chatStoreBase,
      setAgentId: vi.fn(),
      refreshAgents: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
      loadMoreSessions: vi.fn(async () => {}),
      openSession: vi.fn(async () => {}),
      newChat: vi.fn(async () => {}),
      sendMessage,
      compactActive: vi.fn(async () => {}),
      deleteActive: vi.fn(async () => {}),
    };
    const hostApi = {
      getConfig: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => ({})),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
        getStatus: vi.fn(async () => await statusPromise),
      },
      onStatusChange: vi.fn(() => () => {}),
    };

    const core = { connectionStore, approvalsStore, chatStore } as unknown as OperatorCore;
    const matchMedia = stubMatchMedia("(min-width: 800px)", true);
    const testRoot = renderIntoDocument(
      React.createElement(
        OperatorUiHostProvider,
        { value: { kind: "desktop", api: hostApi } },
        React.createElement(ChatPage, { core }),
      ),
    );

    try {
      const composer = testRoot.container.querySelector<HTMLTextAreaElement>("textarea");
      const sendButton =
        composer?.closest("div.flex.items-end.gap-3")?.querySelector<HTMLButtonElement>("button") ??
        null;
      expect(composer).not.toBeNull();
      expect(sendButton).not.toBeNull();

      await act(async () => {
        setNativeValue(composer!, "first draft");
      });
      await act(async () => {
        click(sendButton!);
        await Promise.resolve();
      });

      expect(composer?.value).toBe("");
      expect(sendMessage).not.toHaveBeenCalled();

      await act(async () => {
        setNativeValue(composer!, "new draft");
      });

      resolveStatus({ status: "connected", connected: true, deviceId: "node-1" });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sendMessage).toHaveBeenCalledWith("first draft", { attachedNodeId: "node-1" });
      expect(composer?.value).toBe("new draft");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });
});
