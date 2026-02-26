// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import type { OperatorWsClient, OperatorHttpClient } from "../../operator-core/src/deps.js";
import { OperatorUiApp } from "../src/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (data: unknown) => void;

class FakeWsClient implements OperatorWsClient {
  connected = false;
  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  approvalResolve = vi.fn(async () => {
    throw new Error("not implemented");
  });

  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

function sampleStatusResponse() {
  return {
    status: "ok",
    version: "0.1.0",
    instance_id: "gateway-1",
    role: "gateway",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
  } as const;
}

function sampleUsageResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    scope: { kind: "deployment", run_id: null, key: null, agent_id: null },
    local: {
      attempts: { total_with_cost: 0, parsed: 0, invalid: 0 },
      totals: { duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd_micros: 0 },
    },
    provider: null,
  } as const;
}

function samplePresenceResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  } as const;
}

function samplePairingRequestPending() {
  return {
    pairing_id: 1,
    status: "pending",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      last_seen_at: "2026-01-01T00:00:00.000Z",
      capabilities: [],
    },
    capability_allowlist: [],
    resolution: null,
    resolved_at: null,
  } as const;
}

function samplePairingRequestApproved() {
  return {
    ...samplePairingRequestPending(),
    status: "approved",
    trust_level: "local",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
      reason: "ok",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  } as const;
}

function sampleApprovalPending() {
  return {
    approval_id: 1,
    kind: "other",
    status: "pending",
    prompt: "Allow the tool call?",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    resolution: null,
  } as const;
}

function sampleApprovalApproved() {
  return {
    ...sampleApprovalPending(),
    status: "approved",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
      reason: "ok",
    },
  } as const;
}

function sampleExecutionRun() {
  return {
    run_id: "11111111-1111-1111-1111-111111111111",
    job_id: "22222222-2222-2222-2222-222222222222",
    key: "key-1",
    lane: "main",
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
  } as const;
}

function createFakeHttpClient(): {
  http: OperatorHttpClient;
  statusGet: ReturnType<typeof vi.fn>;
  usageGet: ReturnType<typeof vi.fn>;
  presenceList: ReturnType<typeof vi.fn>;
  pairingsList: ReturnType<typeof vi.fn>;
  pairingsApprove: ReturnType<typeof vi.fn>;
  pairingsDeny: ReturnType<typeof vi.fn>;
  pairingsRevoke: ReturnType<typeof vi.fn>;
} {
  const statusGet = vi.fn(async () => sampleStatusResponse());
  const usageGet = vi.fn(async () => sampleUsageResponse());
  const presenceList = vi.fn(async () => samplePresenceResponse());
  const pairingsList = vi.fn(async () => ({ status: "ok", pairings: [samplePairingRequestPending()] }) as const);
  const pairingsApprove = vi.fn(async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const);
  const pairingsDeny = vi.fn(async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const);
  const pairingsRevoke = vi.fn(async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const);

  const http: OperatorHttpClient = {
    status: { get: statusGet },
    usage: { get: usageGet },
    presence: { list: presenceList },
    pairings: {
      list: pairingsList,
      approve: pairingsApprove,
      deny: pairingsDeny,
      revoke: pairingsRevoke,
    },
  };

  return {
    http,
    statusGet,
    usageGet,
    presenceList,
    pairingsList,
    pairingsApprove,
    pairingsDeny,
    pairingsRevoke,
  };
}

describe("operator-ui", () => {
  it("renders the operator shell navigation", () => {
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

    expect(container.textContent).toContain("Dashboard");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("switches pages from the sidebar", () => {
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

    expect(container.textContent).toContain("Connect");

    const approvalsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-approvals"]');
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Approvals");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("connects and disconnects via operator-core", () => {
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

    expect(container.textContent).toContain("disconnected");

    const connectButton = container.querySelector<HTMLButtonElement>('[data-testid="connect-button"]');
    expect(connectButton).not.toBeNull();

    act(() => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.connect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("connecting");

    const disconnectButton =
      container.querySelector<HTMLButtonElement>('[data-testid="disconnect-button"]');
    expect(disconnectButton).not.toBeNull();

    act(() => {
      disconnectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.disconnect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("disconnected");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("refreshes and displays status on the dashboard", async () => {
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
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

    const dashboardLink =
      container.querySelector<HTMLButtonElement>('[data-testid="nav-dashboard"]');
    expect(dashboardLink).not.toBeNull();

    act(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton =
      container.querySelector<HTMLButtonElement>('[data-testid="dashboard-refresh-status"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(statusGet).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("gateway-1");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("lists and resolves pending approvals", async () => {
    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [sampleApprovalPending()],
      next_cursor: undefined,
    });
    ws.approvalResolve.mockResolvedValueOnce({ approval: sampleApprovalApproved() });

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

    const approvalsLink =
      container.querySelector<HTMLButtonElement>('[data-testid="nav-approvals"]');
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton =
      container.querySelector<HTMLButtonElement>('[data-testid="approvals-refresh"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Allow the tool call?");

    const approveButton =
      container.querySelector<HTMLButtonElement>('[data-testid="approval-approve-1"]');
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalResolve).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Allow the tool call?");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("lists and approves pairing requests", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsApprove.mockResolvedValueOnce({
      status: "ok",
      pairing: samplePairingRequestApproved(),
    });

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

    const pairingLink =
      container.querySelector<HTMLButtonElement>('[data-testid="nav-pairing"]');
    expect(pairingLink).not.toBeNull();

    act(() => {
      pairingLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton =
      container.querySelector<HTMLButtonElement>('[data-testid="pairing-refresh"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("node-1");

    const approveButton =
      container.querySelector<HTMLButtonElement>('[data-testid="pairing-approve-1"]');
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("node-1");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders incoming runs on the timeline page", () => {
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

    const runsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-runs"]');
    expect(runsLink).not.toBeNull();

    act(() => {
      runsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("No runs yet");

    act(() => {
      ws.emit("run.updated", { payload: { run: sampleExecutionRun() } });
    });

    expect(container.textContent).toContain("11111111-1111-1111-1111-111111111111");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("refreshes usage in settings", async () => {
    const ws = new FakeWsClient();
    const { http, usageGet } = createFakeHttpClient();
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

    const settingsLink =
      container.querySelector<HTMLButtonElement>('[data-testid="nav-settings"]');
    expect(settingsLink).not.toBeNull();

    act(() => {
      settingsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton =
      container.querySelector<HTMLButtonElement>('[data-testid="settings-refresh-usage"]');
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(usageGet).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Total tokens: 0");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
