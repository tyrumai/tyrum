// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { axe } from "vitest-axe";
import { toHaveNoViolations } from "vitest-axe/matchers.js";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-core/src/deps.js";
import { OperatorUiApp } from "../src/index.js";
import { formatAxeIncompleteSummary, OPERATOR_UI_WCAG_AA_RUN_OPTIONS } from "./a11y-config.js";
import { stubMatchMedia } from "./test-utils.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
expect.extend({ toHaveNoViolations });

type Handler = (data: unknown) => void;

class FakeWsClient implements OperatorWsClient {
  connected: boolean;
  constructor(initiallyConnected = true) {
    this.connected = initiallyConnected;
  }
  connect = vi.fn(() => {
    if (this.connected) {
      this.emit("connected", { clientId: null });
    }
  });
  disconnect = vi.fn(() => {
    this.emit("disconnected", { code: 1000, reason: "client disconnect" });
  });
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
  sessionList = vi.fn(async () => ({ sessions: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    session: {
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      summary: "",
      turns: [],
      updated_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  }));
  sessionCreate = vi.fn(async () => ({
    session_id: "session-1",
    agent_id: "default",
    channel: "ui",
    thread_id: "ui-session-1",
  }));
  sessionCompact = vi.fn(async () => ({
    session_id: "session-1",
    dropped_messages: 0,
    kept_messages: 0,
  }));
  sessionDelete = vi.fn(async () => ({ session_id: "session-1" }));
  sessionSend = vi.fn(async () => ({ session_id: "session-1", assistant_message: "" }));
  commandExecute = vi.fn(async () => ({}));

  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      if (event === "connected" && this.connected) {
        handler({ clientId: null });
      }
      return;
    }
    this.handlers.set(event, new Set([handler]));
    if (event === "connected" && this.connected) {
      handler({ clientId: null });
    }
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

function createFakeHttpClient(): { http: OperatorHttpClient } {
  const http: OperatorHttpClient = {
    status: { get: vi.fn(async () => sampleStatusResponse()) },
    usage: { get: vi.fn(async () => sampleUsageResponse()) },
    presence: { list: vi.fn(async () => samplePresenceResponse()) },
    agentList: { get: vi.fn(async () => ({ agents: [{ agent_key: "default" }] }) as const) },
    pairings: {
      list: vi.fn(async () => ({ status: "ok", pairings: [] }) as const),
      approve: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
      deny: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
      revoke: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
    },
  };
  return { http };
}

type OperatorUiA11yRouteId =
  | "connect"
  | "dashboard"
  | "chat"
  | "memory"
  | "approvals"
  | "runs"
  | "pairing"
  | "configure"
  | "settings"
  | "node-configure"
  | "browser";

async function expectNoAxeViolationsForRoute({
  mode,
  route,
}: {
  mode: "web" | "desktop";
  route: OperatorUiA11yRouteId;
}): Promise<void> {
  document.title = "Tyrum";
  document.body.innerHTML = "";

  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = () => null;
  }

  const matchMedia = mode === "web" ? stubMatchMedia("(min-width: 768px)", true) : null;

  const ws = new FakeWsClient(route !== "connect");
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
  try {
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode }));
    });

    if (route !== "connect") {
      const navButton = container.querySelector<HTMLButtonElement>(`[data-testid="nav-${route}"]`);
      expect(navButton).not.toBeNull();
      act(() => {
        navButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    await act(async () => {
      await Promise.resolve();
    });

    const results = await axe(container, OPERATOR_UI_WCAG_AA_RUN_OPTIONS);
    const incompleteSummary = formatAxeIncompleteSummary({
      results,
      context: `operator-ui route=${route} mode=${mode}`,
    });
    if (incompleteSummary) {
      // Warn-only for now: jsdom lacks the layout engine needed for some axe checks.
      console.warn(incompleteSummary);
    }
    expect(results).toHaveNoViolations();
  } finally {
    matchMedia?.cleanup();
    act(() => {
      root?.unmount();
    });
    container.remove();
  }
}

describe("operator-ui a11y", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases: Array<{ mode: "web" | "desktop"; route: OperatorUiA11yRouteId }> = [
    { mode: "desktop", route: "connect" },
    { mode: "desktop", route: "dashboard" },
    { mode: "desktop", route: "chat" },
    { mode: "desktop", route: "memory" },
    { mode: "desktop", route: "approvals" },
    { mode: "desktop", route: "runs" },
    { mode: "desktop", route: "pairing" },
    { mode: "desktop", route: "settings" },
    { mode: "desktop", route: "node-configure" },
    { mode: "desktop", route: "configure" },
    { mode: "web", route: "connect" },
    { mode: "web", route: "dashboard" },
    { mode: "web", route: "chat" },
    { mode: "web", route: "memory" },
    { mode: "web", route: "approvals" },
    { mode: "web", route: "runs" },
    { mode: "web", route: "pairing" },
    { mode: "web", route: "settings" },
    { mode: "web", route: "configure" },
    { mode: "web", route: "browser" },
  ];

  for (const testCase of cases) {
    it(
      `has no WCAG AA axe violations on ${testCase.mode}:${testCase.route}`,
      { timeout: 15_000 },
      async () => {
        await expectNoAxeViolationsForRoute(testCase);
      },
    );
  }
});
