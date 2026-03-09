import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleApprovalPending,
} from "./operator-ui.test-fixtures.js";

function registerDashboardTests(): void {
  it("refreshes and displays status on the dashboard", async () => {
    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValue({
      approvals: [sampleApprovalPending()],
      next_cursor: undefined,
    });
    const { http, statusGet, usageGet, presenceList, pairingsList } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const dashboardLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-dashboard"]',
    );
    expect(dashboardLink).not.toBeNull();

    act(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const pageHeader = container.querySelector<HTMLElement>("header");
    expect(pageHeader).not.toBeNull();
    expect(pageHeader?.className).toContain("h-14");

    expect(container.querySelector('[data-testid="dashboard-refresh-status"]')).toBeNull();

    const syncButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-sync-now"]',
    );
    expect(syncButton).not.toBeNull();

    const approvalsLiveRegion = container.querySelector<HTMLDivElement>(
      '[data-testid="dashboard-approvals-live"]',
    );
    expect(approvalsLiveRegion).not.toBeNull();
    expect(approvalsLiveRegion?.getAttribute("aria-live")).toBe("polite");
    expect(approvalsLiveRegion?.getAttribute("aria-atomic")).toBe("true");
    expect(approvalsLiveRegion?.className).toContain("sr-only");

    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(statusGet.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(usageGet.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(presenceList.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(pairingsList.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(ws.approvalList.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("Pending approvals");
    expect(container.textContent).not.toContain("Instance ID");
    expect(container.textContent).not.toContain("Tokens Used");
    expect(container.textContent).toContain("Active runs");
    expect(container.textContent).toContain("Pending pairings");

    expect(container.querySelector('[data-testid="dashboard-approvals-badge"]')).toBeNull();

    const approvalsLiveRegionAfter = container.querySelector<HTMLDivElement>(
      '[data-testid="dashboard-approvals-live"]',
    );
    expect(approvalsLiveRegionAfter).toBe(approvalsLiveRegion);
    expect(approvalsLiveRegionAfter?.textContent).toContain("1 pending approvals");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("navigates to approvals when clicking the pending approvals card", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const dashboardLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-dashboard"]',
    );
    expect(dashboardLink).not.toBeNull();

    act(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const approvalsCard = container.querySelector<HTMLDivElement>(
      '[data-testid="dashboard-card-approvals"]',
    );
    expect(approvalsCard).not.toBeNull();

    act(() => {
      approvalsCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="approvals-pending-live"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("navigates to active runs when clicking the active runs card", async () => {
    const ws = new FakeWsClient();
    ws.runList.mockResolvedValueOnce({
      runs: [
        {
          run: {
            run_id: "11111111-1111-1111-1111-111111111111",
            job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            key: "agent:default:main",
            lane: "main",
            status: "running",
            attempt: 1,
            created_at: "2026-01-01T00:00:00.000Z",
            started_at: "2026-01-01T00:00:00.000Z",
            finished_at: null,
          },
          agent_key: "default",
        },
      ],
      steps: [],
      attempts: [],
    });
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const dashboardLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-dashboard"]',
    );
    expect(dashboardLink).not.toBeNull();

    act(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const runsCard = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-runs"]',
    );
    expect(runsCard).not.toBeNull();

    await act(async () => {
      runsCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Active runs");
    expect(
      container.querySelector('[data-testid="run-status-11111111-1111-1111-1111-111111111111"]'),
    ).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("wraps navigation in the View Transitions API when available", () => {
    const startViewTransition = vi.fn(function (this: unknown, callback: () => void) {
      callback();
      return { finished: Promise.resolve() };
    });

    const original = (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;

    try {
      const ws = new FakeWsClient();
      const { http } = createFakeHttpClient();
      const core = createOperatorCore({
        wsUrl: "ws://example.test/ws",
        httpBaseUrl: "http://example.test",
        auth: createBearerTokenAuth("test"),
        deps: { ws, http },
      });

      const container = document.createElement("div");
      document.body.appendChild(container);

      let root: Root | null = null;
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      const dashboardLink = container.querySelector<HTMLButtonElement>(
        '[data-testid="nav-dashboard"]',
      );
      expect(dashboardLink).not.toBeNull();

      act(() => {
        dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(startViewTransition.mock.contexts[0]).toBe(document);

      act(() => {
        root?.unmount();
      });
      container.remove();
    } finally {
      if (typeof original === "undefined") {
        delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
      } else {
        (document as unknown as { startViewTransition?: unknown }).startViewTransition = original;
      }
    }
  });
}

function registerNavShortcutTests(): void {
  it("supports Cmd/Ctrl+1-8 page navigation shortcuts across the primary routes", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "3", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="activity-page"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "8", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="configure-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-memory"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-runs"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-settings"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("ignores Cmd/Ctrl+1-9/0 shortcuts while disconnected and lands on dashboard after reconnect", async () => {
    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "2", ctrlKey: true, bubbles: true }),
      );
    });

    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();

    await act(async () => {
      ws.connected = true;
      ws.emit("connected", { clientId: null });
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="dashboard-card-connection"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="memory-inspector"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

export function registerDashboardNavTests(): void {
  registerDashboardTests();
  registerNavShortcutTests();
}
