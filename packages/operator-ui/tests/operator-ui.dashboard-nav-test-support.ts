import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
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
    expect(pageHeader).toBeNull();

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
    expect(container.textContent).toContain("Pending Approvals");
    expect(container.textContent).not.toContain("Instance ID");
    expect(container.textContent).not.toContain("Tokens Used");
    expect(container.textContent).toContain("Active Runs");
    expect(container.textContent).toContain("Pending nodes");

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

  it("navigates to agents when clicking the active runs card", async () => {
    const ws = new FakeWsClient();
    ws.transcriptList.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "session-root-1-id",
          session_key: "session-root-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "thread-root-1",
          title: "Default Agent session",
          message_count: 2,
          updated_at: "2026-01-01T00:01:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          archived: false,
          latest_run_id: "11111111-1111-1111-1111-111111111111",
          latest_run_status: "running",
          has_active_run: true,
          pending_approval_count: 0,
        },
      ],
      next_cursor: null,
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

    expect(container.querySelector('[data-testid="agents-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="transcripts-page"]')).not.toBeNull();
    expect(container.textContent).toContain("Default Agent session");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("opens the matching agents run context from a recent run row", async () => {
    const ws = new FakeWsClient();
    const runId = "99999999-1111-4111-8111-111111111111";
    const uiSessionKey = "agent:scout:ui:default:channel:ui-thread-1";
    const sessionSummary = {
      session_id: "session-scout-id",
      session_key: uiSessionKey,
      agent_id: "scout",
      channel: "ui",
      thread_id: "ui-thread-1",
      title: "Scout session",
      message_count: 2,
      updated_at: "2026-01-01T00:02:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      archived: false,
      latest_run_id: runId,
      latest_run_status: "succeeded" as const,
      has_active_run: false,
      pending_approval_count: 0,
    };
    ws.runList.mockResolvedValue({
      runs: [
        {
          run: {
            run_id: runId,
            job_id: "22222222-2222-4222-8222-222222222222",
            key: uiSessionKey,
            lane: "main",
            status: "succeeded",
            attempt: 2,
            created_at: "2026-01-01T00:00:00.000Z",
            started_at: "2026-01-01T00:01:00.000Z",
            finished_at: "2026-01-01T00:02:00.000Z",
          },
          agent_key: "scout",
        },
      ],
      steps: [],
      attempts: [],
    });
    ws.transcriptList.mockResolvedValue({
      sessions: [sessionSummary],
      next_cursor: null,
    });
    ws.transcriptGet.mockResolvedValue({
      root_session_key: uiSessionKey,
      focus_session_key: uiSessionKey,
      sessions: [sessionSummary],
      events: [
        {
          event_id: `run:${uiSessionKey}:${runId}`,
          kind: "run",
          occurred_at: "2026-01-01T00:02:00.000Z",
          session_key: uiSessionKey,
          payload: {
            run: {
              run_id: runId,
              job_id: "22222222-2222-4222-8222-222222222222",
              key: uiSessionKey,
              lane: "main",
              status: "succeeded",
              attempt: 2,
              created_at: "2026-01-01T00:00:00.000Z",
              started_at: "2026-01-01T00:01:00.000Z",
              finished_at: "2026-01-01T00:02:00.000Z",
            },
            steps: [],
            attempts: [],
          },
        },
      ],
    });
    const { http } = createFakeHttpClient();
    http.agents.list = vi.fn(
      async () =>
        ({
          agents: [
            {
              agent_id: "00000000-0000-4000-8000-000000000010",
              agent_key: "scout",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-01T00:00:00.000Z",
              has_config: true,
              has_identity: true,
              is_primary: true,
              can_delete: false,
              persona: {
                name: "Scout",
                tone: "Direct",
                palette: "neutral",
                character: "operator",
              },
            },
          ],
        }) as const,
    );
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

    await act(async () => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const recentRunRow = container.querySelector<HTMLTableRowElement>(
      `[data-testid="dashboard-recent-run-row-${runId}"]`,
    );
    expect(recentRunRow).not.toBeNull();

    await act(async () => {
      recentRunRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="agents-page"]')).not.toBeNull();
    expect(container.textContent).toContain("Scout session");
    expect(container.textContent).toContain("Run key");
    expect(container.textContent).toContain(uiSessionKey);
    expect(ws.transcriptGet).toHaveBeenLastCalledWith({ session_key: uiSessionKey });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("opens the policy tab when clicking the sandbox mode dashboard row", async () => {
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

    await act(async () => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    const sandboxRow = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-card-sandbox-mode"]',
    );
    expect(sandboxRow).not.toBeNull();

    await act(async () => {
      sandboxRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="configure-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="admin-http-policy-panel"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="admin-http-tab-policy"]')?.getAttribute("data-state"),
    ).toBe("active");

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
  it("supports Cmd/Ctrl+1-0 page navigation shortcuts across the primary routes", async () => {
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

    expect(container.querySelector('[data-testid="approvals-pending-live"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "6", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="extensions-page"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "9", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="configure-page"]')).not.toBeNull();
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
