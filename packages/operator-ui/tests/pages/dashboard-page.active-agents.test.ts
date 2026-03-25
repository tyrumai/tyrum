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
  }).store;
}

function createStatusStore(sessionLanes: unknown[]) {
  return createStore({
    status: {
      version: "1.0.0",
      db_kind: "sqlite",
      is_exposed: false,
      auth: { enabled: true },
      session_lanes: sessionLanes,
      queue_depth: null,
      sandbox: null,
      config_health: { status: "ok", issues: [] },
    },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: "2026-03-08T00:00:00.000Z",
  }).store;
}

function createRunsStore(
  runs: Record<string, unknown>,
  agentKeyByRunId: Record<string, string> = {},
) {
  return createStore({
    runsById: runs,
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
    agentKeyByRunId,
    sessionKeyByRunId: {},
  }).store;
}

function createNodesHttp() {
  return {
    nodes: {
      list: vi.fn(async () => sampleDashboardNodeInventoryResponse()),
    },
  };
}

describe("DashboardPage active agents KPI", () => {
  it("uses the managed-agent list for the denominator and session lanes as an active fallback", async () => {
    const runsStore = createRunsStore(
      {
        "run-1": {
          run_id: "run-1",
          key: "agent:default:main",
          lane: "main",
          status: "running",
        },
      },
      { "run-1": "default" },
    );
    const chatStore = createChatStore(["default", "helper"]);
    const statusStore = createStatusStore([
      {
        key: "agent:helper:main",
        lane: "main",
        latest_run_status: "running",
        queued_runs: 0,
        lease_active: true,
      },
    ]);
    const { core, setConnectionState } = createMockCore({
      runsStore,
      statusStore,
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
    expect(agentsCard?.textContent).toContain("2/2");

    cleanupTestRoot({ container, root });
  });

  it("shows managed agents with no active runs as 0 over the real total", async () => {
    const chatStore = createChatStore(["default"]);
    const statusStore = createStatusStore([]);
    const { core, setConnectionState } = createMockCore({
      chatStore,
      statusStore,
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
    const runsStore = createRunsStore(
      {
        "run-1": {
          run_id: "run-1",
          key: "agent:default:main",
          lane: "main",
          status: "running",
        },
      },
      { "run-1": "default" },
    );
    const { core, setConnectionState } = createMockCore({
      chatStore,
      runsStore,
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
