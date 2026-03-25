// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "../../../operator-app/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage recent runs", () => {
  it("renders the recent runs empty state", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Recent Runs");
    expect(container.textContent).toContain("No recent runs");

    cleanupTestRoot({ container, root });
  });

  it("renders work distribution, security posture, and recent runs with data", () => {
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
    const { store: transcriptStore } = createStore({
      agentKey: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [
        {
          session_id: "session-1",
          session_key: "agent:scout:ui:main",
          agent_key: "scout",
          channel: "ui",
          thread_id: "thread-scout",
          title: "Scout UI thread",
          message_count: 2,
          updated_at: "2026-03-08T00:00:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_run_id: "run-1",
          latest_run_status: "succeeded" as const,
          has_active_run: false,
          pending_approval_count: 0,
          account_key: "default",
          container_kind: "dm",
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
    const { store: runsStore } = createStore({
      runsById: {
        "run-1": {
          run_id: "run-1",
          job_id: "job-1",
          key: "agent:scout:ui:main",
          lane: "main",
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: { "run-1": "scout" },
      sessionKeyByRunId: { "run-1": "agent:scout:ui:main" },
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
      runsStore,
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
    expect(container.textContent).toContain("Recent Runs");
    expect(container.textContent).toContain("Run run-1");

    cleanupTestRoot({ container, root });
  });

  it("opens recent runs with explicit agent, run, and session linkage", () => {
    const sessionKey = "agent:default:ui:main";
    const { store: chatStore } = createStore({
      agentKey: "",
      agents: {
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
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
    const { store: transcriptStore } = createStore({
      agentKey: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [
        {
          session_id: "session-1",
          session_key: sessionKey,
          agent_key: "default",
          channel: "ui",
          thread_id: "thread-default",
          title: "Default UI thread",
          message_count: 1,
          updated_at: "2026-03-08T00:00:00.000Z",
          created_at: "2026-03-08T00:00:00.000Z",
          archived: false,
          latest_run_id: "run-1",
          latest_run_status: "running" as const,
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
    const { store: runsStore } = createStore({
      runsById: {
        "run-1": {
          run_id: "run-1",
          job_id: "job-1",
          key: sessionKey,
          lane: "main",
          status: "running" as const,
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
      agentKeyByRunId: { "run-1": "default" },
      sessionKeyByRunId: { "run-1": sessionKey },
    });
    const onOpenAgentRun = vi.fn();
    const { core } = createMockCore({ chatStore, transcriptStore, runsStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentRun }),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="dashboard-recent-run-row-run-1"]',
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentRun).toHaveBeenCalledWith({
      agentKey: "default",
      runId: "run-1",
      sessionKey,
    });

    cleanupTestRoot({ container, root });
  });

  it("passes a null sessionKey for runs without retained-session linkage", () => {
    const { store: chatStore } = createStore({
      agentKey: "",
      agents: {
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
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
    const { store: transcriptStore } = createStore({
      agentKey: null as string | null,
      channel: null as string | null,
      activeOnly: false,
      archived: false,
      sessions: [],
      nextCursor: null as string | null,
      selectedSessionKey: null as string | null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
      errorList: null,
      errorDetail: null,
    });
    const { store: runsStore } = createStore({
      runsById: {
        "run-standalone": {
          run_id: "run-standalone",
          job_id: "job-standalone",
          key: "opaque-run-key",
          lane: "cron",
          status: "succeeded" as const,
          attempt: 1,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:10.000Z",
          finished_at: "2026-03-08T00:01:00.000Z",
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: { "run-standalone": "default" },
      sessionKeyByRunId: {},
    });
    const onOpenAgentRun = vi.fn();
    const { core } = createMockCore({ chatStore, transcriptStore, runsStore });

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, { core, onOpenAgentRun }),
    );

    const row = container.querySelector<HTMLElement>(
      '[data-testid="dashboard-recent-run-row-run-standalone"]',
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenAgentRun).toHaveBeenCalledWith({
      agentKey: "default",
      runId: "run-standalone",
      sessionKey: null,
    });

    cleanupTestRoot({ container, root });
  });
});
