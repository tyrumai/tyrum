import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { axe } from "vitest-axe";
import { toHaveNoViolations } from "vitest-axe/matchers.js";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-app/src/deps.js";
import {
  WsConversationCreateResult,
  WsConversationDeleteResult,
  WsConversationGetResult,
} from "@tyrum/contracts";
import { OperatorUiApp } from "../src/index.js";
import { OPERATOR_UI_WCAG_AA_RUN_OPTIONS } from "./a11y-config.js";
import { stubMatchMedia } from "./test-utils.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
expect.extend({ toHaveNoViolations });

const sonnerMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: sonnerMocks,
}));

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
  runList = vi.fn(async () => ({ runs: [], steps: [], attempts: [] }));
  approvalResolve = vi.fn(async () => {
    throw new Error("not implemented");
  });
  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryUpdate = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);
  requestDynamic = vi.fn(
    async (type: string, payload: unknown, schema?: { parse?: (input: unknown) => unknown }) => {
      let result: unknown;
      switch (type) {
        case "conversation.list":
          result = await this.sessionList(payload);
          break;
        case "conversation.get":
          result = await this.sessionGet(payload);
          break;
        case "conversation.create":
          result = await this.sessionCreate(payload);
          break;
        case "conversation.delete":
          result = await this.sessionDelete(payload);
          break;
        case "conversation.queue_mode.set":
          result = await this.sessionQueueModeSet(
            payload as { queue_mode: string; conversation_id: string },
          );
          break;
        default:
          throw new Error(`unsupported dynamic request: ${type}`);
      }
      return schema?.parse ? schema.parse(result) : result;
    },
  );
  onDynamicEvent = vi.fn((event: string, handler: Handler) => this.on(event, handler));
  offDynamicEvent = vi.fn((event: string, handler: Handler) => this.off(event, handler));
  sessionList = vi.fn(async () => ({ conversations: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    conversation: WsConversationGetResult.parse({
      conversation: {
        conversation_id: "session-1",
        agent_key: "default",
        channel: "ui",
        thread_id: "ui-session-1",
        title: "",
        message_count: 0,
        queue_mode: "steer",
        last_message: null,
        messages: [],
        updated_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    }).conversation,
  }));
  sessionCreate = vi.fn(
    async () =>
      WsConversationCreateResult.parse({
        conversation: {
          conversation_id: "session-1",
          agent_key: "default",
          channel: "ui",
          thread_id: "ui-session-1",
          title: "",
          message_count: 0,
          queue_mode: "steer",
          last_message: null,
          messages: [],
          updated_at: "2026-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }).conversation,
  );
  sessionDelete = vi.fn(async () =>
    WsConversationDeleteResult.parse({ conversation_id: "session-1" }),
  );
  sessionQueueModeSet = vi.fn(async (payload: { queue_mode: string; conversation_id: string }) => ({
    conversation_id: payload.conversation_id,
    queue_mode: payload.queue_mode,
  }));
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
    auth: { enabled: true },
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
    config_health: { status: "ok", issues: [] },
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

function sampleAgentStatusResponse() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
    },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
    },
    skills: ["review", "deploy"],
    workspace_skills_trusted: true,
    mcp: [
      {
        id: "filesystem",
        name: "Filesystem",
        enabled: true,
        transport: "stdio",
      },
    ],
    tools: ["shell", "http"],
    conversations: {
      ttl_days: 365,
      max_turns: 0,
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
      loop_detection: {
        within_turn: {
          consecutive_repeat_limit: 2,
          cycle_repeat_limit: 3,
        },
        cross_turn: {
          window_assistant_messages: 8,
          similarity_threshold: 0.92,
        },
      },
    },
  } as const;
}

function createFakeHttpClient(): { http: OperatorHttpClient } {
  const http: OperatorHttpClient = {
    status: { get: vi.fn(async () => sampleStatusResponse()) },
    usage: { get: vi.fn(async () => sampleUsageResponse()) },
    presence: { list: vi.fn(async () => samplePresenceResponse()) },
    agentList: { get: vi.fn(async () => ({ agents: [{ agent_key: "default" }] }) as const) },
    agentStatus: { get: vi.fn(async () => sampleAgentStatusResponse()) },
    desktopEnvironmentHosts: {
      list: vi.fn(async () => ({ status: "ok", hosts: [] }) as const),
    },
    desktopEnvironments: {
      list: vi.fn(async () => ({ status: "ok", environments: [] }) as const),
      getDefaults: vi.fn(
        async () =>
          ({
            status: "ok",
            default_image_ref: "ghcr.io/tyrumai/tyrum-desktop-sandbox:stable",
            revision: 1,
            created_at: "2026-03-10T12:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: null,
            reverted_from_revision: null,
          }) as const,
      ),
      get: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      create: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      updateDefaults: vi.fn(
        async (input: { default_image_ref: string; reason?: string }) =>
          ({
            status: "ok",
            default_image_ref: input.default_image_ref,
            revision: 2,
            created_at: "2026-03-10T12:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: input.reason ?? null,
            reverted_from_revision: null,
          }) as const,
      ),
      update: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      start: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      stop: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      reset: vi.fn(async () => ({ status: "ok", environment: null }) as const),
      remove: vi.fn(async () => ({ status: "ok", deleted: true }) as const),
      logs: vi.fn(async () => ({ status: "ok", environment_id: "env-1", logs: [] }) as const),
      createTakeoverSession: vi.fn(
        async () =>
          ({
            status: "ok",
            session: {
              session_id: "session-1",
              entry_url:
                "http://127.0.0.1:8788/desktop-takeover/s/token-1/vnc.html?autoconnect=true",
              expires_at: "2026-03-10T12:30:00.000Z",
            },
          }) as const,
      ),
    },
    pairings: {
      list: vi.fn(async () => ({ status: "ok", pairings: [] }) as const),
      approve: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
      deny: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
      revoke: vi.fn(async () => ({ status: "ok", pairing: null }) as const),
    },
  };
  return { http };
}

export type OperatorUiA11yRouteId =
  | "connect"
  | "dashboard"
  | "chat"
  | "approvals"
  | "agents"
  | "pairing"
  | "desktop-environments"
  | "configure"
  | "desktop"
  | "browser";

export type OperatorUiA11yCase = {
  mode: "web" | "desktop";
  route: OperatorUiA11yRouteId;
};

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
    expect(results).toHaveNoViolations();
  } finally {
    await act(async () => {
      core.dispose();
      root?.unmount();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    matchMedia?.cleanup();
    container.remove();
  }
}

export function runOperatorUiA11ySuite(cases: readonly OperatorUiA11yCase[]): void {
  describe("operator-ui a11y", () => {
    beforeEach(() => {
      const originalConsoleError = console.error;
      vi.spyOn(console, "error").mockImplementation((message?: unknown, ...rest: unknown[]) => {
        if (
          typeof message === "string" &&
          message.includes("A suspended resource finished loading inside a test")
        ) {
          return;
        }
        originalConsoleError(message, ...rest);
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

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
}
