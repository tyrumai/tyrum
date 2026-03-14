// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
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
    const core = {
      approvalsStore,
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
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(React.createElement(AiSdkChatPage, { core }));

    expect(testRoot.container.textContent).toContain("AI SDK chat transport unavailable");

    cleanupTestRoot(testRoot);
  });
});
