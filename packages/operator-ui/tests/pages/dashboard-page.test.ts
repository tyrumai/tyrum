// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("DashboardPage", () => {
  it("uses the precomputed tokens text value without a duplicate type guard in JSX", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/operator-ui/src/components/pages/dashboard-page.tsx"),
      "utf8",
    );

    expect(source).not.toContain('value={typeof tokensUsed === "number" ? tokensUsedText : "-"}');
  });

  it("pulses the connection dot only while connecting", () => {
    const { store: connectionStore, setState: setConnectionState } = createStore({
      status: "disconnected",
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
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
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
      items: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const core = {
      connectionStore,
      statusStore,
      approvalsStore,
      pairingStore,
      runsStore,
      workboardStore,
    } as unknown as OperatorCore;

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

  it("shows the active-runs badge only when the computed count is positive", () => {
    const { store: connectionStore } = createStore({
      status: "connected",
      clientId: null,
      lastDisconnect: null,
      transportError: null,
    });

    const { store: statusStore, setState: setStatusState } = createStore({
      status: {
        queue_depth: {
          execution_runs: {
            queued: 0,
            running: 0,
            paused: 0,
          },
        },
      },
      usage: null,
      presenceByInstanceId: {},
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: null,
    });

    const { store: approvalsStore } = createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const { store: pairingStore } = createStore({
      byId: {},
      pendingIds: [],
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
      items: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    });

    const core = {
      connectionStore,
      statusStore,
      approvalsStore,
      pairingStore,
      runsStore,
      workboardStore,
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(testRoot.container.querySelector('[data-testid="dashboard-runs-badge"]')).toBeNull();

    act(() => {
      setStatusState((prev) => ({
        ...prev,
        status: {
          queue_depth: {
            execution_runs: {
              queued: 1,
              running: 1,
              paused: 0,
            },
          },
        },
      }));
    });

    const badge = testRoot.container.querySelector('[data-testid="dashboard-runs-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("2");

    cleanupTestRoot(testRoot);
  });
});
