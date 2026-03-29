// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage recent activity heartbeat", () => {
  it("renders heartbeat recent activity instead of generic agent conversation", () => {
    const { store: chatStore } = createStore({
      agentKey: "",
      agents: {
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
        loading: false,
        error: null,
      },
      conversations: { conversations: [], nextCursor: null, loading: false, error: null },
      archivedConversations: {
        conversations: [],
        nextCursor: null,
        loading: false,
        loaded: false,
        error: null,
      },
      active: { conversationId: null, conversation: null, loading: false, error: null },
    });
    const { store: transcriptStore } = createStore({
      agentKey: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      conversations: [],
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
        "run-heartbeat": {
          turn_id: "run-heartbeat",
          job_id: "job-heartbeat",
          conversation_key: "agent:default:automation:default~ops:channel:custom-heartbeat",
          status: "running" as const,
          attempt: 1,
          created_at: "2026-03-08T00:02:00.000Z",
          started_at: "2026-03-08T00:02:10.000Z",
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
      agentKeyByTurnId: { "run-heartbeat": "default" },
      conversationKeyByTurnId: {},
      triggerKindByTurnId: { "run-heartbeat": "heartbeat" as const },
    });
    const { core } = createMockCore({ chatStore, transcriptStore, turnsStore });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Heartbeat");
    expect(container.textContent).not.toContain("Agent conversation");

    cleanupTestRoot({ container, root });
  });
});
