// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import {
  createMockCore,
  sampleDashboardNodeInventoryResponse,
} from "./dashboard-page.test-support.js";

function createChatStore(agentIds: string[]) {
  return createStore({
    agentKey: "",
    agents: {
      agents: agentIds.map((agent_key) => ({ agent_key })),
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
      conversations: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: {
      conversationId: null,
      conversation: null,
      loading: false,
      error: null,
    },
  }).store;
}

function createTurnsStore(
  runs: Record<string, unknown>,
  agentKeyByTurnId: Record<string, string> = {},
) {
  return createStore({
    turnsById: runs,
    turnItemsById: {},
    turnItemIdsByTurnId: {},
    agentKeyByTurnId,
    conversationKeyByTurnId: {},
  }).store;
}

function createNodesHttp() {
  return {
    nodes: {
      list: vi.fn(async () => sampleDashboardNodeInventoryResponse()),
    },
  };
}

function createTranscriptStore(conversations: unknown[]) {
  return createStore({
    agentKey: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    conversations: conversations,
    nextCursor: null as string | null,
    selectedConversationKey: null as string | null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  }).store;
}

describe("DashboardPage active agents KPI", () => {
  it("uses the managed-agent list for the denominator and transcript activity as a fallback", async () => {
    const turnsStore = createTurnsStore(
      {
        "run-1": {
          turn_id: "run-1",
          conversation_key: "agent:default:main",
          status: "running",
        },
      },
      { "run-1": "default" },
    );
    const chatStore = createChatStore(["default", "helper"]);
    const transcriptStore = createTranscriptStore([
      {
        conversation_id: "conversation-helper",
        conversation_key: "agent:helper:ui:main",
        agent_key: "helper",
        channel: "ui",
        thread_id: "helper-main",
        title: "Helper conversation",
        message_count: 2,
        updated_at: "2026-03-08T00:00:00.000Z",
        created_at: "2026-03-08T00:00:00.000Z",
        archived: false,
        latest_turn_id: "turn-helper",
        latest_turn_status: "running",
        has_active_turn: true,
        pending_approval_count: 0,
      },
    ]);
    const { core, setConnectionState } = createMockCore({
      turnsStore,
      chatStore,
      transcriptStore,
      http: createNodesHttp(),
    });

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const agentsCard = container.querySelector('[data-testid="dashboard-card-agents"]');
    expect(agentsCard?.textContent).toContain("2/2");

    cleanupTestRoot({ container, root });
  });

  it("shows managed agents with no active turns as 0 over the real total", async () => {
    const chatStore = createChatStore(["default"]);
    const { core, setConnectionState } = createMockCore({
      chatStore,
      http: createNodesHttp(),
    });

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const agentsCard = container.querySelector('[data-testid="dashboard-card-agents"]');
    expect(agentsCard?.textContent).toContain("0/1");

    cleanupTestRoot({ container, root });
  });

  it("does not depend on the admin agents endpoint for active-agent counts", async () => {
    const chatStore = createChatStore(["default"]);
    const turnsStore = createTurnsStore(
      {
        "run-1": {
          turn_id: "run-1",
          conversation_key: "agent:default:main",
          status: "running",
        },
      },
      { "run-1": "default" },
    );
    const { core, setConnectionState } = createMockCore({
      chatStore,
      turnsStore,
      http: {
        nodes: {
          list: vi.fn(async () => sampleDashboardNodeInventoryResponse()),
        },
      },
    });

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    await act(async () => {
      await Promise.resolve();
    });

    const agentsCard = container.querySelector('[data-testid="dashboard-card-agents"]');
    expect(agentsCard?.textContent).toContain("1/1");

    cleanupTestRoot({ container, root });
  });
});
