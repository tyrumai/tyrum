// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage recent activity stale transcript handling", () => {
  it("shows the newest turn when transcript activity for the same conversation is stale", () => {
    const conversationKey = "agent:default:ui:main";
    const { store: chatStore } = createStore({
      agentKey: "",
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
    });
    const { store: transcriptStore } = createStore({
      agentKey: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      conversations: [
        {
          conversation_id: "conversation-ui",
          conversation_key: conversationKey,
          agent_key: "default",
          channel: "ui",
          thread_id: "main",
          title: "Main UI thread",
          message_count: 1,
          updated_at: "2026-03-08T00:01:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_turn_id: "turn-old",
          latest_turn_status: "succeeded" as const,
          has_active_turn: false,
          pending_approval_count: 0,
        },
      ],
      nextCursor: null as string | null,
      selectedConversationKey: null as string | null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
      errorList: null,
      errorDetail: null,
    });
    const { store: turnsStore } = createStore({
      turnsById: {
        "turn-old": {
          turn_id: "turn-old",
          job_id: "job-old",
          conversation_key: conversationKey,
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
        "turn-new": {
          turn_id: "turn-new",
          job_id: "job-new",
          conversation_key: conversationKey,
          status: "running" as const,
          attempt: 2,
          created_at: "2026-03-08T00:02:00.000Z",
          started_at: "2026-03-08T00:02:10.000Z",
          finished_at: null,
        },
      },
      turnItemsById: {},
      turnItemIdsByTurnId: {},
      agentKeyByTurnId: {
        "turn-old": "default",
        "turn-new": "default",
      },
      conversationKeyByTurnId: {
        "turn-old": conversationKey,
        "turn-new": conversationKey,
      },
    });
    const onOpenAgentActivity = vi.fn();
    const { core } = createMockCore({ chatStore, transcriptStore, turnsStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentActivity }),
    );

    expect(
      container.querySelector('[data-testid="dashboard-recent-activity-row-turn-new"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="dashboard-recent-activity-row-turn-old"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Turn turn-new");
    expect(container.textContent).not.toContain("Turn turn-old");

    const row = container.querySelector<HTMLElement>(
      '[data-testid="dashboard-recent-activity-row-turn-new"]',
    );
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentActivity).toHaveBeenCalledWith({
      agentKey: "default",
      turnId: "turn-new",
      conversationKey,
    });

    cleanupTestRoot({ container, root });
  });
});
