// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import type { OperatorWsClient, OperatorHttpClient } from "../../operator-core/src/deps.js";
import { AdminModeGate, AdminModeProvider, OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import { stubMatchMedia } from "./test-utils.js";

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
  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryUpdate = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);
  commandExecute = vi.fn(async () => ({}));

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
    run_id: "11111111-1111-1111-1111-deadbeefcafe",
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

type SampleExecutionStepStatus =
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

type SampleExecutionAttemptStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";

function sampleExecutionStep({
  stepId,
  stepIndex,
  status,
  actionType,
}: {
  stepId: string;
  stepIndex: number;
  status: SampleExecutionStepStatus;
  actionType: "Decide" | "Research";
}) {
  return {
    step_id: stepId,
    run_id: sampleExecutionRun().run_id,
    step_index: stepIndex,
    status,
    action: { type: actionType, args: {} },
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

function sampleExecutionAttempt({
  attemptId,
  attempt,
  status,
  stepId,
  startedAt = "2026-01-01T00:00:00.000Z",
  finishedAt = null,
}: {
  attemptId: string;
  attempt: number;
  status: SampleExecutionAttemptStatus;
  stepId: string;
  startedAt?: string;
  finishedAt?: string | null;
}) {
  return {
    attempt_id: attemptId,
    step_id: stepId,
    attempt,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    error: null,
    artifacts: [],
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
  const pairingsList = vi.fn(
    async () => ({ status: "ok", pairings: [samplePairingRequestPending()] }) as const,
  );
  const pairingsApprove = vi.fn(
    async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const,
  );
  const pairingsDeny = vi.fn(
    async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const,
  );
  const pairingsRevoke = vi.fn(
    async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const,
  );

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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not export AdminModeBanner from the public API", () => {
    expect("AdminModeBanner" in operatorUi).toBe(false);
  });

  it("applies the stored theme mode when mounting OperatorUiApp", () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => (key === "tyrum.themeMode" ? "light" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock as unknown as Storage);

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

    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not inject the legacy operator-ui css", () => {
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

    const styles = Array.from(container.querySelectorAll("style"));
    expect(styles.some((style) => style.textContent?.includes(".tyrum-operator-ui"))).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not render legacy layout class names", async () => {
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

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    const settingsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-settings"]');
    expect(settingsLink).not.toBeNull();

    act(() => {
      settingsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

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

  it("renders a bottom tab bar on web below md breakpoint", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const matchMedia = stubMatchMedia("(min-width: 768px)", false);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("[data-testid='nav-more']")).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
    matchMedia.cleanup();
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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
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

    const connectButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="connect-button"]',
    );
    expect(connectButton).not.toBeNull();

    act(() => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.connect).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("connecting");

    const disconnectButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="disconnect-button"]',
    );
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

  it("exposes desktop setup controls in desktop mode", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        capabilities: { desktop: true, playwright: false, cli: false, http: false },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connecting" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-start-gateway"]',
    );
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(desktopApi.gateway.start).toHaveBeenCalledTimes(1);
    expect(desktopApi.setConfig).toHaveBeenCalledTimes(0);

    const connectNodeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-connect-node"]',
    );
    expect(connectNodeButton).not.toBeNull();

    await act(async () => {
      connectNodeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="desktop-disconnect-node"]'),
    ).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("disables desktop capability toggles while settings are saving", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    let resolveSetConfig: (() => void) | null = null;
    const setConfigPromise = new Promise<void>((resolve) => {
      resolveSetConfig = resolve;
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        capabilities: { desktop: true, playwright: false, cli: false, http: false },
      })),
      setConfig: vi.fn(async () => {
        await setConfigPromise;
      }),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connecting" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => ({ granted: true })),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const capabilityCheckboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(capabilityCheckboxes.length).toBeGreaterThanOrEqual(4);

    await act(async () => {
      capabilityCheckboxes[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-save-capabilities"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const updatedCheckboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(updatedCheckboxes.length).toBeGreaterThanOrEqual(4);
    for (const checkbox of updatedCheckboxes) {
      expect(checkbox.disabled).toBe(true);
    }

    resolveSetConfig?.();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("does not show Saving status while requesting mac permissions", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    let resolvePermission: (() => void) | null = null;
    const permissionPromise = new Promise<void>((resolve) => {
      resolvePermission = resolve;
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        capabilities: { desktop: true, playwright: false, cli: false, http: false },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connecting" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => {
        await permissionPromise;
        return { granted: true };
      }),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-save-capabilities"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.textContent).toContain("Save settings");

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-request-accessibility"]',
    );
    expect(requestAccessibilityButton).not.toBeNull();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const updatedSaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-save-capabilities"]',
    );
    expect(updatedSaveButton).not.toBeNull();
    expect(updatedSaveButton!.textContent).not.toContain("Saving...");

    resolvePermission?.();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("keeps mac permission request errors visible", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const desktopApi = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        capabilities: { desktop: true, playwright: false, cli: false, http: false },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connecting" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn((_cb: (status: unknown) => void) => () => {}),
      checkMacPermissions: vi.fn(async () => null),
      requestMacPermission: vi.fn(async () => {
        throw new Error("Permission request failed.");
      }),
    };

    (window as unknown as Record<string, unknown>)["tyrumDesktop"] = desktopApi;

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const desktopLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-desktop"]');
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-request-accessibility"]',
    );
    expect(requestAccessibilityButton).not.toBeNull();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(desktopApi.requestMacPermission).toHaveBeenCalledTimes(1);
    expect(desktopApi.checkMacPermissions).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("Permission request failed.");

    act(() => {
      root?.unmount();
    });
    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("disables browser assistance on the login token field", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();
    expect(tokenField!.getAttribute("spellcheck")).toBe("false");
    expect(tokenField!.getAttribute("autocapitalize")).toBe("none");
    expect(tokenField!.getAttribute("autocorrect")).toBe("off");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("sets aria-busy on the login button while logging in", async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async () => fetchPromise);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();
    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const liveButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(liveButton?.getAttribute("aria-busy")).toBe("true");

    resolveFetch?.(new Response(null, { status: 204 }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("logs in via /auth/session in web mode", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "  test-token  ";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rejects blank tokens on the login page", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("Token is required");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces gateway errors when login fails", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "unauthorized", message: "invalid token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("invalid token");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces json error codes when login fails without a message field", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("unauthorized");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces text errors when login fails with non-json response", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("gateway exploded", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const tokenField = container.querySelector<HTMLTextAreaElement>('[data-testid="login-token"]');
    expect(tokenField).not.toBeNull();

    act(() => {
      tokenField!.value = "test-token";
    });

    const loginButton = container.querySelector<HTMLButtonElement>('[data-testid="login-button"]');
    expect(loginButton).not.toBeNull();

    await act(async () => {
      loginButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.connect).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain("gateway exploded");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("surfaces transport and disconnect details on the connect page", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    act(() => {
      ws.emit("transport_error", { message: "socket blew up" });
    });

    expect(container.textContent).toContain("socket blew up");

    act(() => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
    });

    expect(container.textContent).toContain("4001");
    expect(container.textContent).toContain("unauthorized");

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

    const dashboardLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-dashboard"]',
    );
    expect(dashboardLink).not.toBeNull();

    act(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-refresh-status"]',
    );
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
    const toastSuccess = vi
      .spyOn(operatorUi.toast, "success")
      .mockImplementation(() => "" as unknown as string);

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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approvals-refresh"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Allow the tool call?");
    expect(container.textContent).toContain("other");
    expect(container.querySelector('time[datetime="2026-01-01T00:00:00.000Z"]')).not.toBeNull();

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approval-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalResolve).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Approval resolved");
    expect(container.textContent).not.toContain("Allow the tool call?");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("denies approvals with toast feedback", async () => {
    const toastSuccess = vi
      .spyOn(operatorUi.toast, "success")
      .mockImplementation(() => "" as unknown as string);

    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [sampleApprovalPending()],
      next_cursor: undefined,
    });
    ws.approvalResolve.mockResolvedValueOnce({
      approval: { ...sampleApprovalPending(), status: "denied" },
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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approvals-refresh"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const denyButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approval-deny-1"]',
    );
    expect(denyButton).not.toBeNull();

    await act(async () => {
      denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalResolve).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Approval denied");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows an empty state when there are no pending approvals", async () => {
    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [],
      next_cursor: undefined,
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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approvals-refresh"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No pending approvals");
    expect(container.textContent).toContain(
      "Approvals appear here when agents request permission to perform actions.",
    );

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

    const pairingLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-pairing"]');
    expect(pairingLink).not.toBeNull();

    act(() => {
      pairingLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-refresh"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("node-1");

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
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

  it("renders incoming runs on the runs page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));

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
    expect(container.textContent).toContain("Runs appear here when agents start executing.");

    act(() => {
      ws.emit("run.updated", { payload: { run: sampleExecutionRun() } });
    });

    expect(container.textContent).toContain("running");
    expect(container.textContent).toContain("beefcafe");
    expect(container.textContent).toContain("2m ago");

    const step0 = sampleExecutionStep({
      stepId: "33333333-3333-3333-3333-0123456789ab",
      stepIndex: 0,
      status: "queued",
      actionType: "Decide",
    });
    const step1 = sampleExecutionStep({
      stepId: "33333333-3333-3333-3333-acde0000babe",
      stepIndex: 1,
      status: "running",
      actionType: "Research",
    });

    act(() => {
      ws.emit("step.updated", { payload: { step: step1 } });
      ws.emit("step.updated", { payload: { step: step0 } });
    });

    const attempt2 = sampleExecutionAttempt({
      attemptId: "44444444-4444-4444-4444-acde0000beef",
      stepId: step0.step_id,
      attempt: 2,
      status: "running",
    });
    const attempt1 = sampleExecutionAttempt({
      attemptId: "44444444-4444-4444-4444-acde0000face",
      stepId: step0.step_id,
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-01-01T00:00:05.000Z",
    });

    act(() => {
      ws.emit("attempt.updated", { payload: { attempt: attempt2 } });
      ws.emit("attempt.updated", { payload: { attempt: attempt1 } });
    });

    const runToggle = container.querySelector<HTMLButtonElement>(
      `[data-testid="run-toggle-${sampleExecutionRun().run_id}"]`,
    );
    expect(runToggle).not.toBeNull();

    act(() => {
      runToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const pageText = container.textContent ?? "";
    expect(pageText).toContain("Step 0");
    expect(pageText).toContain("Step 1");
    expect(pageText.indexOf("Step 0")).toBeLessThan(pageText.indexOf("Step 1"));

    expect(pageText).toContain("queued");
    expect(container.textContent).toContain("Decide");
    expect(container.textContent).toContain("Research");
    expect(pageText.indexOf("Attempt 1")).toBeLessThan(pageText.indexOf("Attempt 2"));
    expect(pageText).toContain("completed • 5s");

    expect(container.textContent).toContain("Attempt 1");
    expect(container.textContent).toContain("456789ab");
    expect(container.textContent).toContain("0000face");
    expect(container.textContent).toContain("0000beef");

    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const toastSuccess = vi.spyOn(toast, "success");

    const copyRunId = container.querySelector<HTMLButtonElement>(
      `[data-testid="copy-id-${sampleExecutionRun().run_id}"]`,
    );
    expect(copyRunId).not.toBeNull();
    expect(copyRunId?.getAttribute("aria-label")).toBe(`Copy ID ${sampleExecutionRun().run_id}`);

    await act(async () => {
      copyRunId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(sampleExecutionRun().run_id);
    expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");

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

    const settingsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-settings"]');
    expect(settingsLink).not.toBeNull();

    act(() => {
      settingsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const refreshButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-refresh-usage"]',
    );
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

  it("shows an Admin Mode banner with TTL and allows exit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));

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

    expect(container.querySelector('[data-testid="admin-mode-banner"]')).toBeNull();

    act(() => {
      const expiresAt = new Date(Date.now() + 5_000).toISOString();
      core.adminModeStore.enter({ elevatedToken: "elevated-token", expiresAt });
    });

    const banner = container.querySelector('[data-testid="admin-mode-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Admin Mode");
    expect(banner?.textContent).toMatch(/\d+:\d{2}/);

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-exit"]',
    );
    expect(exitButton).not.toBeNull();

    act(() => {
      exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="admin-mode-banner"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("gates an admin-only Settings action behind Admin Mode", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(issuedAt));

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("POST");
      expect(headers.get("authorization")).toBe("Bearer admin-token");

      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: "operator-ui",
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: expiresAt,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    const settingsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-settings"]');
    expect(settingsLink).not.toBeNull();

    act(() => {
      settingsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="settings-admin-command-execute"]')).toBeNull();
    expect(container.textContent).toContain("Enter Admin Mode to continue");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const tokenField = document.querySelector<HTMLInputElement>('[data-testid="admin-mode-token"]');
    expect(tokenField).not.toBeNull();
    act(() => {
      tokenField!.value = "admin-token";
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="admin-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(core.adminModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt,
    });
    expect(container.querySelector('[data-testid="admin-mode-banner"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="settings-admin-command-execute"]'),
    ).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("gates admin-only actions behind a shared Admin Mode flow", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(issuedAt));

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("POST");
      expect(headers.get("authorization")).toBe("Bearer admin-token");

      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: "operator-ui",
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: expiresAt,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(AdminModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            AdminModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
    });

    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(container.textContent).toContain("Enter Admin Mode to continue");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="admin-mode-dialog"]');
    expect(dialog).not.toBeNull();

    const tokenField = document.querySelector<HTMLInputElement>('[data-testid="admin-mode-token"]');
    expect(tokenField).not.toBeNull();
    expect(tokenField!.type).toBe("password");
    expect(tokenField!.getAttribute("autocomplete")).toBe("off");

    const toggleTokenButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-token-toggle"]',
    );
    expect(toggleTokenButton).not.toBeNull();
    act(() => {
      toggleTokenButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(tokenField!.type).toBe("text");
    act(() => {
      toggleTokenButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(tokenField!.type).toBe("password");

    act(() => {
      tokenField!.value = "  admin-token  ";
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="admin-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(core.adminModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt,
    });

    expect(container.querySelector('[data-testid="admin-mode-banner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders an accessible Admin Mode dialog and closes on Escape", () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(AdminModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            AdminModeGate,
            null,
            React.createElement(
              "button",
              { type: "button", "data-testid": "danger-action" },
              "Danger action",
            ),
          ),
        }),
      );
    });

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="admin-mode-dialog"]');
    expect(dialog).not.toBeNull();

    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();

    const tokenField = document.querySelector<HTMLInputElement>('[data-testid="admin-mode-token"]');
    expect(tokenField).not.toBeNull();
    expect(tokenField!.type).toBe("password");

    act(() => {
      tokenField?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[data-testid="admin-mode-dialog"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
