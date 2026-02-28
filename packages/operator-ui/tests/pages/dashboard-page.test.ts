// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { DashboardPage } from "../../src/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("DashboardPage", () => {
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

    const core = {
      connectionStore,
      statusStore,
      approvalsStore,
      pairingStore,
      runsStore,
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const getConnectionDot = (): HTMLSpanElement => {
      const label = Array.from(container.querySelectorAll("span")).find(
        (span) => span.textContent === "Connection Status",
      );
      expect(label).toBeDefined();

      const card = label?.closest<HTMLDivElement>("div.rounded-lg");
      expect(card).not.toBeNull();

      const dot = card?.querySelector<HTMLSpanElement>("span.rounded-full");
      expect(dot).not.toBeNull();

      return dot as HTMLSpanElement;
    };

    expect(getConnectionDot().className).not.toContain("animate-pulse");

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connecting" }));
    });
    expect(getConnectionDot().className).toContain("animate-pulse");

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });
    expect(getConnectionDot().className).not.toContain("animate-pulse");

    cleanupTestRoot({ container, root });
  });
});

