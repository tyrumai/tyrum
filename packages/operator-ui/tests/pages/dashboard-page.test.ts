// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const emptyActivityState: ActivityState = {
  agentsById: {},
  agentIds: [],
  workstreamsById: {},
  workstreamIds: [],
  selectedAgentId: null,
  selectedWorkstreamId: null,
};

function createMockActivityStore() {
  const { store } = createStore<ActivityState>(emptyActivityState);
  return {
    ...store,
    clearSelection: vi.fn(),
    selectWorkstream: vi.fn(),
  };
}

function createMockCore(overrides?: Partial<Record<string, unknown>>) {
  const { store: connectionStore, setState: setConnectionState } = createStore({
    status: "disconnected" as string,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });

  const { store: statusStore } = createStore({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });

  const { store: approvalsStore } = createStore({
    byId: {},
    pendingIds: [] as string[],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  const { store: pairingStore } = createStore({
    byId: {},
    pendingIds: [] as string[],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  const { store: runsStore } = createStore({
    runsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
  });

  const { store: workboardStore } = createStore({
    items: [] as unknown[],
    supported: null as boolean | null,
    tasksByWorkItemId: {},
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  const activityStore = createMockActivityStore();

  const core = {
    connectionStore,
    statusStore,
    approvalsStore,
    pairingStore,
    runsStore,
    workboardStore,
    activityStore,
    ...overrides,
  } as unknown as OperatorCore;

  return { core, setConnectionState };
}

describe("DashboardPage", () => {
  it("does not use the old precomputed tokens text pattern", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/operator-ui/src/components/pages/dashboard-page.tsx"),
      "utf8",
    );

    expect(source).not.toContain('value={typeof tokensUsed === "number" ? tokensUsedText : "-"}');
  });

  it("uses a responsive KPI grid layout with system status and usage cards", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/operator-ui/src/components/pages/dashboard-page.tsx"),
      "utf8",
    );

    expect(source).toContain("KpiCard");
    expect(source).toContain("sm:grid-cols-4");
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain("System Status");
    expect(source).toContain("Token Usage");
  });

  it("pulses the connection dot only while connecting", () => {
    const { core, setConnectionState } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const getConnectionDot = (): HTMLSpanElement => {
      const card = container.querySelector<HTMLDivElement>(
        '[data-testid="dashboard-card-connection"]',
      );
      expect(card).not.toBeNull();

      const dot = card?.querySelector<HTMLSpanElement>("span.rounded-full");
      expect(dot).not.toBeNull();

      return dot as HTMLSpanElement;
    };

    expect(getConnectionDot().className).toContain("bg-error");
    expect(getConnectionDot().className).not.toContain("animate-pulse");

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connecting" }));
    });
    expect(getConnectionDot().className).toContain("bg-warning");
    expect(getConnectionDot().className).toContain("animate-pulse");

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });
    expect(getConnectionDot().className).toContain("bg-success");
    expect(getConnectionDot().className).not.toContain("animate-pulse");

    cleanupTestRoot({ container, root });
  });

  it("does not render badge test IDs in dashboard cards", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/operator-ui/src/components/pages/dashboard-page.tsx"),
      "utf8",
    );

    expect(source).not.toContain("dashboard-approvals-badge");
    expect(source).not.toContain("dashboard-runs-badge");
    expect(source).not.toContain("dashboard-pairing-badge");
    expect(source).not.toContain("dashboard-agents-badge");
  });

  it("navigates to the configured connection route from the connection row", () => {
    const { core, setConnectionState } = createMockCore();
    // Set connected so the banner doesn't show (we test the system status row)
    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });

    const onNavigate = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(DashboardPage, {
        core,
        onNavigate,
        connectionRouteId: "desktop",
      }),
    );

    const connectionRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-connection"]',
    );
    expect(connectionRow).not.toBeNull();

    act(() => {
      connectionRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith("desktop");

    cleanupTestRoot({ container, root });
  });

  it("renders KPI cards with correct test IDs", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.querySelector('[data-testid="dashboard-card-approvals"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-card-runs"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-card-agents"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-card-open-work"]')).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("shows the connection banner when disconnected", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const banner = container.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("renders the activity feed section", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Recent Activity");
    expect(container.textContent).toContain("No recent activity");

    cleanupTestRoot({ container, root });
  });

  it("renders work distribution, token usage, and activity feed with data", () => {
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
      status: { version: "1.0.0", db_kind: "sqlite", sandbox: false },
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

    const activityState: ActivityState = {
      agentsById: {},
      agentIds: [],
      workstreamIds: ["ws-1"],
      workstreamsById: {
        "ws-1": {
          id: "ws-1",
          key: "agent:scout:main",
          lane: "main",
          agentId: "scout",
          persona: { name: "Scout" },
          latestRunId: null,
          runStatus: null,
          queuedRunCount: 0,
          lease: { held: false },
          attentionLevel: "none",
          attentionScore: 0,
          currentRoom: { kind: "idle" },
          bubbleText: null,
          recentEvents: [
            {
              id: "ev-1",
              type: "run.updated",
              occurredAt: "2026-03-08T00:00:00.000Z",
              summary: "Run completed",
            },
          ],
        } as unknown as ActivityState["workstreamsById"][string],
      },
      selectedAgentId: null,
      selectedWorkstreamId: null,
    };
    const { store: activityStoreBase } = createStore<ActivityState>(activityState);
    const activityStore = {
      ...activityStoreBase,
      clearSelection: vi.fn(),
      selectWorkstream: vi.fn(),
    };

    const { core } = createMockCore({
      workboardStore: {
        ...workboardStore,
        refreshList: async () => {},
        resetSupportProbe: () => {},
        upsertWorkItem: () => {},
      },
      statusStore,
      activityStore,
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    // Work distribution bar rendered with segments
    expect(container.textContent).toContain("Work Distribution");
    expect(container.textContent).toContain("Doing (1)");
    expect(container.textContent).toContain("Done (1)");
    expect(container.textContent).toContain("Backlog (1)");

    // Token usage bar rendered
    expect(container.textContent).toContain("50,000");
    expect(container.textContent).toContain("Input: 30,000");
    expect(container.textContent).toContain("Output: 20,000");
    expect(container.textContent).toContain("$0.42");

    // Activity feed rendered
    expect(container.textContent).toContain("Scout");
    expect(container.textContent).toContain("Run completed");

    cleanupTestRoot({ container, root });
  });
});
