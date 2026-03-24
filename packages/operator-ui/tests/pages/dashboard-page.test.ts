// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "../../../operator-app/src/store.js";
import { AppShell } from "../../src/components/layout/app-shell.js";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import {
  cleanupTestRoot,
  renderIntoDocument,
  stubAppShellContentWidth,
  stubMatchMedia,
} from "../test-utils.js";
import {
  createMockCore,
  sampleDashboardNodeInventoryResponse,
} from "./dashboard-page.test-support.js";

describe("DashboardPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not use the old precomputed tokens text pattern", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/operator-ui/src/components/pages/dashboard-page.tsx"),
      "utf8",
    );

    expect(source).not.toContain('value={typeof tokensUsed === "number" ? tokensUsedText : "-"}');
  });

  it("reflows the dashboard grids based on app shell content width", () => {
    const matchMedia = stubMatchMedia("(min-width: 768px)", false);
    const measurements = stubAppShellContentWidth(700);
    const { core } = createMockCore();
    let testRoot: ReturnType<typeof renderIntoDocument> | null = null;

    try {
      testRoot = renderIntoDocument(
        React.createElement(
          AppShell,
          {
            mode: "desktop",
            sidebar: React.createElement("div"),
            mobileNav: null,
          },
          React.createElement(DashboardPage, { core }),
        ),
      );

      const kpiGrid = testRoot.container.querySelector("[data-testid='dashboard-kpi-grid']");
      const summaryGrid = testRoot.container.querySelector(
        "[data-testid='dashboard-summary-grid']",
      );
      const layoutContent = testRoot.container.querySelector("[data-layout-content]");

      expect(kpiGrid?.className).toContain("grid-cols-2");
      expect(kpiGrid?.className).not.toContain("grid-cols-4");
      expect(summaryGrid?.className).toContain("grid-cols-1");
      expect(summaryGrid?.className).not.toContain("grid-cols-2");
      expect(layoutContent?.getAttribute("data-layout-alignment")).toBe("center");

      measurements.setWidth(820);
      measurements.notifyResize();

      expect(kpiGrid?.className).toContain("grid-cols-4");
      expect(kpiGrid?.className).not.toContain("grid-cols-2");
      expect(summaryGrid?.className).toContain("grid-cols-2");
      expect(summaryGrid?.className).not.toContain("grid-cols-1");
      expect(layoutContent?.getAttribute("data-layout-alignment")).toBe("center");
    } finally {
      if (testRoot) {
        cleanupTestRoot(testRoot);
      }
      matchMedia.cleanup();
      measurements.cleanup();
    }
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

  it("keeps help buttons separate while routing clickable status rows to the right settings", () => {
    const { core, setConnectionState } = createMockCore();
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

    const sandboxHelp = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Explain sandbox mode"]',
    );
    expect(sandboxHelp).not.toBeNull();

    act(() => {
      sandboxHelp?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();

    const sandboxRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-sandbox-mode"]',
    );
    const authRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-authentication"]',
    );
    const exposureRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-network-exposure"]',
    );
    expect(sandboxRow).not.toBeNull();
    expect(authRow).not.toBeNull();
    expect(exposureRow).not.toBeNull();

    act(() => {
      sandboxRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenLastCalledWith("configure", "policy");

    act(() => {
      authRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenLastCalledWith("configure", "device-tokens");

    act(() => {
      exposureRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenLastCalledWith("desktop");

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

  it("renders the security card without crashing when auth status is absent", () => {
    const { store: statusStore } = createStore({
      status: {
        version: "1.0.0",
        db_kind: "sqlite",
        is_exposed: false,
        sandbox: null,
        config_health: { status: "ok", issues: [] },
      },
      usage: null,
      presenceByInstanceId: {},
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    });
    const { core } = createMockCore({ statusStore });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("Security");
    expect(container.textContent).toContain("Auth");

    cleanupTestRoot({ container, root });
  });

  it("renders help affordances for sandbox and security status rows", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const helpLabels = [
      "Explain sandbox mode",
      "Explain network exposure",
      "Explain authentication",
      "Explain policy mode",
      "Explain sandbox hardening",
      "Explain elevated execution",
    ] as const;

    for (const label of helpLabels) {
      expect(container.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }

    cleanupTestRoot({ container, root });
  });

  it("shows the connection banner when disconnected", () => {
    const { core } = createMockCore();

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    const banner = container.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("counts connected nodes from live node inventory instead of presence entries", async () => {
    const liveInventory = sampleDashboardNodeInventoryResponse();
    const { store: statusStore } = createStore({
      status: {
        version: "1.0.0",
        db_kind: "sqlite",
        is_exposed: false,
        auth: { enabled: true },
        sandbox: null,
        config_health: { status: "ok", issues: [] },
      },
      usage: null,
      presenceByInstanceId: {
        gateway: { instance_id: "gateway", role: "gateway", last_seen_at: "2026-03-08T00:00:00Z" },
        client: { instance_id: "client", role: "client", last_seen_at: "2026-03-08T00:00:00Z" },
        "node-1": { instance_id: "node-1", role: "node", last_seen_at: "2026-03-08T00:00:00Z" },
        "node-2": { instance_id: "node-2", role: "node", last_seen_at: "2026-03-08T00:00:00Z" },
      },
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    });
    const { core, setConnectionState } = createMockCore({
      statusStore,
      http: {
        nodes: {
          list: vi.fn(async () => ({
            ...liveInventory,
            nodes: [
              {
                ...liveInventory.nodes[0],
                node_id: "node-1",
                connected: true,
              },
              {
                ...liveInventory.nodes[0],
                node_id: "node-2",
                connected: true,
                paired_status: null,
              },
            ],
          })),
        },
      },
    });

    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const connectedNodesRow = container.querySelector(
      '[data-testid="dashboard-card-connected-nodes"]',
    );
    expect(connectedNodesRow?.textContent).toContain("Connected nodes");
    expect(connectedNodesRow?.textContent).toContain("2");

    cleanupTestRoot({ container, root });
  });
});
