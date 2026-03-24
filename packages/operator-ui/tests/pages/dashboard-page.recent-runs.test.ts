// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage recent runs", () => {
  it("renders the recent runs section", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Recent Runs");
    expect(container.textContent).toContain("No recent runs");

    cleanupTestRoot({ container, root });
  });

  it("renders configuration health issues and navigates to the relevant page", () => {
    const { store: statusStore } = createStore({
      status: {
        version: "1.0.0",
        db_kind: "sqlite",
        is_exposed: false,
        auth: { enabled: true },
        sandbox: null,
        config_health: {
          status: "issues",
          issues: [
            {
              code: "no_provider_accounts",
              severity: "error",
              message: "No active provider accounts are configured.",
              target: { kind: "deployment", id: null },
            },
            {
              code: "agent_model_unconfigured",
              severity: "error",
              message: "Agent 'default' has no primary model configured.",
              target: { kind: "agent", id: "default" },
            },
          ],
        },
      },
      usage: null,
      presenceByInstanceId: {},
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    });
    const onNavigate = vi.fn();
    const { core } = createMockCore({ statusStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onNavigate }),
    );

    expect(container.querySelector('[data-testid="dashboard-config-health"]')).not.toBeNull();
    expect(container.textContent).toContain("Configuration Health");
    expect(container.textContent).toContain("No active provider accounts are configured.");
    expect(container.textContent).toContain("Agent 'default' has no primary model configured.");

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="dashboard-config-health"] button',
      ),
    );
    expect(buttons).toHaveLength(2);

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenNthCalledWith(1, "configure");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "agents");

    cleanupTestRoot({ container, root });
  });

  it("renders work distribution, security posture, and recent runs with source labels", () => {
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
    const runId = "99999999-1111-1111-1111-111111111111";
    const uiSessionKey = "agent:scout:ui:default:channel:ui-thread-1";
    const heartbeatRunId = "88888888-1111-1111-1111-111111111111";
    const { store: runsStore } = createStore({
      runsById: {
        [runId]: {
          run_id: runId,
          job_id: "22222222-2222-2222-2222-222222222222",
          key: uiSessionKey,
          lane: "main",
          status: "succeeded",
          attempt: 2,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:01:00.000Z",
          finished_at: "2026-03-08T00:02:00.000Z",
        },
        [heartbeatRunId]: {
          run_id: heartbeatRunId,
          job_id: "33333333-2222-2222-2222-222222222222",
          key: "agent:scout:main",
          lane: "heartbeat",
          status: "running",
          attempt: 1,
          created_at: "2026-03-08T00:03:00.000Z",
          started_at: "2026-03-08T00:03:10.000Z",
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: {
        [runId]: "scout",
      },
    });
    const { store: transcriptStoreBase } = createStore({
      agentId: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [
        {
          session_id: "session-scout-id",
          session_key: uiSessionKey,
          agent_id: "scout",
          channel: "ui",
          thread_id: "ui-thread-1",
          account_key: "default",
          container_kind: "channel",
          title: "Scout session",
          message_count: 4,
          updated_at: "2026-03-08T00:02:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_run_id: runId,
          latest_run_status: "succeeded",
          has_active_run: false,
          pending_approval_count: 0,
        },
      ],
      nextCursor: null as string | null,
      selectedSessionKey: null as string | null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
      errorList: null,
      errorDetail: null,
    });
    const transcriptStore = {
      ...transcriptStoreBase,
      setAgentId: vi.fn(),
      setChannel: vi.fn(),
      setActiveOnly: vi.fn(),
      setArchived: vi.fn(),
      refresh: vi.fn(),
      loadMore: vi.fn(),
      openSession: vi.fn(),
      clearDetail: vi.fn(),
    };
    const { store: chatStore } = createStore({
      agentId: "",
      agents: {
        agents: [{ agent_id: "scout", persona: { name: "Scout" } }],
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

    const { core } = createMockCore({
      workboardStore: {
        ...workboardStore,
        refreshList: async () => {},
        resetSupportProbe: () => {},
        upsertWorkItem: () => {},
      },
      statusStore,
      runsStore,
      transcriptStore,
      chatStore,
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

    expect(container.querySelector('[data-testid="dashboard-recent-runs-table"]')).not.toBeNull();
    expect(container.textContent).toContain("Scout");
    expect(container.textContent).toContain("UI thread");
    expect(container.textContent).toContain("ui-thread-1");
    expect(container.textContent).toContain("Heartbeat");
    expect(container.textContent).toContain("Run 99999999");
    expect(container.textContent).toContain("succeeded");

    cleanupTestRoot({ container, root });
  });

  it("routes recent run row clicks with the matching agent, session, and run", () => {
    const runId = "aaaaaaaa-1111-1111-1111-111111111111";
    const uiSessionKey = "agent:scout:ui:default:channel:ui-thread-1";
    const { store: runsStore } = createStore({
      runsById: {
        [runId]: {
          run_id: runId,
          job_id: "bbbbbbbb-2222-2222-2222-222222222222",
          key: uiSessionKey,
          lane: "main",
          status: "running",
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: {
        [runId]: "scout",
      },
    });
    const { store: transcriptStoreBase } = createStore({
      agentId: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [
        {
          session_id: "session-scout-id",
          session_key: uiSessionKey,
          agent_id: "scout",
          channel: "ui",
          thread_id: "ui-thread-1",
          account_key: "default",
          container_kind: "channel",
          title: "Scout session",
          message_count: 4,
          updated_at: "2026-03-08T00:00:10.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_run_id: runId,
          latest_run_status: "running",
          has_active_run: true,
          pending_approval_count: 0,
        },
      ],
      nextCursor: null as string | null,
      selectedSessionKey: null as string | null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
      errorList: null,
      errorDetail: null,
    });
    const transcriptStore = {
      ...transcriptStoreBase,
      setAgentId: vi.fn(),
      setChannel: vi.fn(),
      setActiveOnly: vi.fn(),
      setArchived: vi.fn(),
      refresh: vi.fn(),
      loadMore: vi.fn(),
      openSession: vi.fn(),
      clearDetail: vi.fn(),
    };
    const { store: chatStore } = createStore({
      agentId: "",
      agents: {
        agents: [{ agent_id: "scout", persona: { name: "Scout" } }],
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
    const onOpenAgentRun = vi.fn();
    const { core } = createMockCore({
      runsStore,
      transcriptStore,
      chatStore,
    });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentRun }),
    );
    const row = container.querySelector<HTMLTableRowElement>(
      `[data-testid="dashboard-recent-run-row-${runId}"]`,
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentRun).toHaveBeenCalledWith({
      agentKey: "scout",
      runId,
      sessionKey: uiSessionKey,
    });

    cleanupTestRoot({ container, root });
  });

  it("prefers transcript source metadata over parsing the session key", () => {
    const runId = "cccccccc-1111-1111-1111-111111111111";
    const sessionKey = "agent:scout:telegram:ops:group:peer-123";
    const { store: runsStore } = createStore({
      runsById: {
        [runId]: {
          run_id: runId,
          job_id: "dddddddd-2222-2222-2222-222222222222",
          key: sessionKey,
          lane: "main",
          status: "succeeded",
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:00:20.000Z",
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: {
        [runId]: "scout",
      },
    });
    const { store: transcriptStoreBase } = createStore({
      agentId: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [
        {
          session_id: "session-scout-metadata",
          session_key: sessionKey,
          agent_id: "scout",
          channel: "telegram",
          thread_id: "peer-123",
          account_key: "ops",
          container_kind: "dm" as const,
          title: "Telegram DM session",
          message_count: 3,
          updated_at: "2026-03-08T00:00:20.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_run_id: runId,
          latest_run_status: "succeeded" as const,
          has_active_run: false,
          pending_approval_count: 0,
        },
      ],
      nextCursor: null as string | null,
      selectedSessionKey: null as string | null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
      errorList: null,
      errorDetail: null,
    });
    const transcriptStore = {
      ...transcriptStoreBase,
      setAgentId: vi.fn(),
      setChannel: vi.fn(),
      setActiveOnly: vi.fn(),
      setArchived: vi.fn(),
      refresh: vi.fn(),
      loadMore: vi.fn(),
      openSession: vi.fn(),
      clearDetail: vi.fn(),
    };
    const { store: chatStore } = createStore({
      agentId: "",
      agents: {
        agents: [{ agent_id: "scout", persona: { name: "Scout" } }],
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
    const { core } = createMockCore({
      runsStore,
      transcriptStore,
      chatStore,
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Telegram DM");
    expect(container.textContent).not.toContain("Telegram group");

    cleanupTestRoot({ container, root });
  });
});
