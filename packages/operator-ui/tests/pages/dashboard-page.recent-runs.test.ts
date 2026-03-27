// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage recent activity", () => {
  it("renders the recent activity empty state", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Recent Activity");
    expect(container.textContent).toContain("No recent activity");

    cleanupTestRoot({ container, root });
  });

  it("renders work distribution, security posture, and recent activity with data", () => {
    const { store: workboardStore } = createStore({
      items: [
        { work_item_id: "wi-1", status: "doing", title: "A", kind: "task", priority: 1 },
        { work_item_id: "wi-2", status: "done", title: "B", kind: "task", priority: 2 },
        { work_item_id: "wi-3", status: "backlog", title: "C", kind: "task", priority: 3 },
      ] as unknown[],
      supported: true,
      tasksByWorkItemId: {},
      loading: false,
      error: null,
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    });
    const { store: statusStore } = createStore({
      status: {
        version: "1.0.0",
        db_kind: "sqlite",
        is_exposed: false,
        auth: { enabled: true },
        policy: {
          observe_only: false,
          effective_sha256: "policy-sha",
          sources: { deployment: "default", agent: null },
        },
        sandbox: {
          mode: "enforce",
          policy_observe_only: false,
          effective_policy_sha256: "policy-sha",
          hardening_profile: "hardened",
          elevated_execution_available: false,
        },
        config_health: { status: "ok", issues: [] },
      },
      usage: {
        local: {
          totals: {
            total_tokens: 50000,
            input_tokens: 30000,
            output_tokens: 20000,
            usd_micros: 420000,
          },
          attempts: { total_with_cost: 10 },
        },
      },
      presenceByInstanceId: {},
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    });
    const { store: chatStore } = createStore({
      agentKey: "",
      agents: {
        agents: [{ agent_key: "scout", persona: { name: "Scout" } }],
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
          conversation_id: "session-1",
          conversation_key: "agent:scout:ui:main",
          agent_key: "scout",
          channel: "ui",
          thread_id: "thread-scout",
          title: "Scout UI thread",
          message_count: 2,
          updated_at: "2026-03-08T00:00:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_turn_id: "run-1",
          latest_turn_status: "succeeded" as const,
          has_active_turn: false,
          pending_approval_count: 0,
          account_key: "default",
          container_kind: "dm",
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
        "run-1": {
          turn_id: "run-1",
          job_id: "job-1",
          conversation_key: "agent:scout:ui:main",
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
      agentKeyByTurnId: { "run-1": "scout" },
      conversationKeyByTurnId: { "run-1": "agent:scout:ui:main" },
    });
    const { core } = createMockCore({
      workboardStore: {
        ...workboardStore,
        refreshList: async () => {},
        resetSupportProbe: () => {},
        upsertWorkItem: () => {},
      },
      statusStore,
      chatStore,
      transcriptStore,
      turnsStore,
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Work Distribution");
    expect(container.textContent).toContain("Doing (1)");
    expect(container.textContent).toContain("Done (1)");
    expect(container.textContent).toContain("Backlog (1)");
    expect(container.textContent).toContain("Security");
    expect(container.textContent).toContain("local only");
    expect(container.textContent).toContain("enabled");
    expect(container.textContent).toContain("enforce");
    expect(container.textContent).toContain("hardened");
    expect(container.textContent).toContain("unavailable");
    expect(container.textContent).toContain("Scout");
    expect(container.textContent).toContain("Recent Activity");
    expect(container.textContent).toContain("Turn run-1");

    cleanupTestRoot({ container, root });
  });

  it("opens recent activity with explicit agent, turn, and conversation linkage", () => {
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
          conversation_id: "session-1",
          conversation_key: conversationKey,
          agent_key: "default",
          channel: "ui",
          thread_id: "thread-default",
          title: "Default UI thread",
          message_count: 1,
          updated_at: "2026-03-08T00:00:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_turn_id: "run-1",
          latest_turn_status: "running" as const,
          has_active_turn: true,
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
        "run-1": {
          turn_id: "run-1",
          job_id: "job-1",
          conversation_key: conversationKey,
          status: "running" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
      agentKeyByTurnId: { "run-1": "default" },
      conversationKeyByTurnId: { "run-1": conversationKey },
    });
    const onOpenAgentActivity = vi.fn();
    const { core } = createMockCore({ chatStore, transcriptStore, turnsStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentActivity }),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="dashboard-recent-activity-row-run-1"]',
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentActivity).toHaveBeenCalledWith({
      agentKey: "default",
      turnId: "run-1",
      conversationKey,
    });

    cleanupTestRoot({ container, root });
  });

  it("passes the turn conversation key for activity without retained transcript linkage", () => {
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
        "run-standalone": {
          turn_id: "run-standalone",
          job_id: "job-standalone",
          conversation_key: "cron:opaque-run-key",
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
      agentKeyByTurnId: { "run-standalone": "default" },
      conversationKeyByTurnId: {},
    });
    const onOpenAgentActivity = vi.fn();
    const { core } = createMockCore({ chatStore, transcriptStore, turnsStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentActivity }),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="dashboard-recent-activity-row-run-standalone"]',
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentActivity).toHaveBeenCalledWith({
      agentKey: "default",
      turnId: "run-standalone",
      conversationKey: "cron:opaque-run-key",
    });

    cleanupTestRoot({ container, root });
  });

  it("renders retained conversations alongside newer standalone turns", () => {
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
          conversation_key: "agent:default:ui:main",
          agent_key: "default",
          channel: "ui",
          thread_id: "main",
          title: "Main UI thread",
          message_count: 1,
          updated_at: "2026-03-08T00:01:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_turn_id: "run-ui",
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
        "run-ui": {
          turn_id: "run-ui",
          job_id: "job-ui",
          conversation_key: "agent:default:ui:main",
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
        "run-cron": {
          turn_id: "run-cron",
          job_id: "job-cron",
          conversation_key: "cron:nightly",
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
      agentKeyByTurnId: {
        "run-ui": "default",
        "run-cron": "default",
      },
      conversationKeyByTurnId: {
        "run-ui": "agent:default:ui:main",
        "run-cron": "cron:nightly",
      },
    });
    const { core } = createMockCore({ chatStore, transcriptStore, turnsStore });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="dashboard-recent-activity-row-"]'),
    );
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "dashboard-recent-activity-row-run-cron",
      "dashboard-recent-activity-row-run-ui",
    ]);
    expect(container.textContent).toContain("Turn run-cron");
    expect(container.textContent).toContain("Turn run-ui");

    cleanupTestRoot({ container, root });
  });
});
