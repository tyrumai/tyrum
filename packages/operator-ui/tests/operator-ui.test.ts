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
import { ElevatedModeGate, ElevatedModeProvider, OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import { PairingPage } from "../src/components/pages/pairing-page.js";
import { stubMatchMedia } from "./test-utils.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (data: unknown) => void;

async function waitForSelector<T extends Element>(
  container: HTMLElement,
  selector: string,
  attempts = 50,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = container.querySelector<T>(selector);
    if (element) return element;
    await act(async () => {
      await Promise.resolve();
      await vi.dynamicImportSettled();
    });
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

async function openConfigureGeneral(container: HTMLElement): Promise<void> {
  const configureLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-configure"]');
  expect(configureLink).not.toBeNull();

  await act(async () => {
    configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });

  const generalTab = await waitForSelector<HTMLButtonElement>(
    container,
    '[data-testid="configure-tab-general"]',
  );

  await act(async () => {
    generalTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

async function openConfigureTab(
  container: HTMLElement,
  tabTestId = "admin-http-tab-gateway",
): Promise<void> {
  const configureLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-configure"]');
  expect(configureLink).not.toBeNull();

  await act(async () => {
    configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });

  const tab = await waitForSelector<HTMLButtonElement>(container, `[data-testid="${tabTestId}"]`);

  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await Promise.resolve();
  });
}

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

const TEST_DEVICE_IDENTITY = {
  deviceId: "operator-ui-device-1",
  publicKey: "test-public-key",
  privateKey: "test-private-key",
} as const;

function setControlledInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as
    | ((this: HTMLInputElement, value: string) => void)
    | undefined;
  if (!setValue) {
    throw new Error("Failed to resolve HTMLInputElement value setter");
  }
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickButtonByTestId(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickTabByLabel(container: HTMLElement, label: string): void {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  );
  expect(tab).not.toBeUndefined();
  tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

function requestInfoToUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function stubUrlObjectUrls(): { restore: () => void } {
  const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:json"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(() => {}),
    configurable: true,
  });

  return {
    restore: () => {
      if (typeof originalCreateObjectURL === "undefined") {
        Reflect.deleteProperty(URL, "createObjectURL");
      } else {
        Object.defineProperty(URL, "createObjectURL", {
          value: originalCreateObjectURL,
          configurable: true,
        });
      }

      if (typeof originalRevokeObjectURL === "undefined") {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      } else {
        Object.defineProperty(URL, "revokeObjectURL", {
          value: originalRevokeObjectURL,
          configurable: true,
        });
      }
    },
  };
}

function createStorageMock(storage: Map<string, string>): Storage {
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  } as unknown as Storage;
}

function stubPersistentStorage(params?: {
  session?: Map<string, string>;
  local?: Map<string, string>;
}): {
  session: Map<string, string>;
  local: Map<string, string>;
} {
  const session = params?.session ?? new Map<string, string>();
  const local = params?.local ?? new Map<string, string>();
  vi.stubGlobal("sessionStorage", createStorageMock(session));
  vi.stubGlobal("localStorage", createStorageMock(local));
  return { session, local };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return { promise, resolve, reject };
}

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
  workList = vi.fn(async () => ({ items: [] }) as unknown);
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

function sampleAgentStatusResponse() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
      description: "Primary operator agent",
    },
    model: {
      model: "openai/gpt-4.1",
      variant: "balanced",
      fallback: ["openai/gpt-4.1-mini"],
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
    sessions: {
      ttl_days: 30,
      max_turns: 20,
      context_pruning: {
        max_messages: 32,
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
      label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
      last_seen_at: "2026-01-01T00:00:00.000Z",
      capabilities: [],
    },
    capability_allowlist: [
      { id: "tyrum.cli", version: "1.0.0" },
      { id: "tyrum.http", version: "1.0.0" },
    ],
    resolution: null,
    resolved_at: null,
  } as const;
}

function samplePairingRequestPendingWithNodeCapabilities() {
  return {
    ...samplePairingRequestPending(),
    node: {
      ...samplePairingRequestPending().node,
      capabilities: ["cli", "http"],
    },
    capability_allowlist: [],
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
    key: "agent:default:main",
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
  deviceTokensIssue: ReturnType<typeof vi.fn>;
  deviceTokensRevoke: ReturnType<typeof vi.fn>;
  statusGet: ReturnType<typeof vi.fn>;
  usageGet: ReturnType<typeof vi.fn>;
  presenceList: ReturnType<typeof vi.fn>;
  pairingsList: ReturnType<typeof vi.fn>;
  pairingsApprove: ReturnType<typeof vi.fn>;
  pairingsDeny: ReturnType<typeof vi.fn>;
  pairingsRevoke: ReturnType<typeof vi.fn>;
  agentListGet: ReturnType<typeof vi.fn>;
  agentStatusGet: ReturnType<typeof vi.fn>;
  modelAssignmentsUpdate: ReturnType<typeof vi.fn>;
} {
  const deviceTokensIssue = vi.fn(async () => ({
    token_kind: "device" as const,
    token: "elevated-device-token",
    token_id: "token-1",
    device_id: TEST_DEVICE_IDENTITY.deviceId,
    role: "client" as const,
    scopes: [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ],
    issued_at: "2026-02-27T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
  }));
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
  const agentListGet = vi.fn(async () => ({ agents: [{ agent_key: "default" }] }) as const);
  const agentStatusGet = vi.fn(async () => sampleAgentStatusResponse());
  const modelAssignmentsUpdate = vi.fn(async () => ({
    status: "ok",
    assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
      execution_profile_id,
      preset_key: "preset-default",
      preset_display_name: "Default",
      provider_key: "openai",
      model_id: "gpt-4.1",
    })),
  }));
  const deviceTokensRevoke = vi.fn(async () => ({ revoked: true }));

  const http: OperatorHttpClient = {
    deviceTokens: {
      issue: deviceTokensIssue,
      revoke: deviceTokensRevoke,
    },
    status: { get: statusGet },
    usage: { get: usageGet },
    presence: { list: presenceList },
    agentStatus: { get: agentStatusGet },
    agentList: { get: agentListGet },
    pairings: {
      list: pairingsList,
      approve: pairingsApprove,
      deny: pairingsDeny,
      revoke: pairingsRevoke,
    },
    providerConfig: {
      listRegistry: vi.fn(async () => ({
        status: "ok",
        providers: [
          {
            provider_key: "openai",
            name: "OpenAI",
            doc: null,
            supported: true,
            methods: [
              {
                method_key: "api_key",
                label: "API key",
                type: "api_key",
                fields: [
                  {
                    key: "api_key",
                    label: "API key",
                    description: null,
                    kind: "secret",
                    input: "password",
                    required: true,
                  },
                ],
              },
            ],
          },
        ],
      })),
      listProviders: vi.fn(async () => ({
        status: "ok",
        providers: [],
      })),
      createAccount: vi.fn(async () => ({ status: "ok" })),
      updateAccount: vi.fn(async () => ({ status: "ok" })),
      deleteAccount: vi.fn(async () => ({ status: "ok" })),
      deleteProvider: vi.fn(async () => ({ status: "ok" })),
    },
    modelConfig: {
      listPresets: vi.fn(async () => ({
        status: "ok",
        presets: [
          {
            preset_id: "c2d1f6c6-f541-46a8-9f47-8a2d0ff3c9e5",
            preset_key: "preset-default",
            display_name: "Default",
            provider_key: "openai",
            model_id: "gpt-4.1",
            options: {},
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
          {
            preset_id: "d5c709e9-4585-426e-81ed-7904f7fbbe1b",
            preset_key: "preset-review",
            display_name: "Review",
            provider_key: "openai",
            model_id: "gpt-4.1-mini",
            options: { reasoning_effort: "medium" },
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      })),
      listAvailable: vi.fn(async () => ({
        status: "ok",
        models: [
          {
            provider_key: "openai",
            provider_name: "OpenAI",
            model_id: "gpt-4.1",
            model_name: "GPT-4.1",
            family: null,
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
          {
            provider_key: "openai",
            provider_name: "OpenAI",
            model_id: "gpt-4.1-mini",
            model_name: "GPT-4.1 Mini",
            family: null,
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
        ],
      })),
      createPreset: vi.fn(async () => ({ status: "ok" })),
      updatePreset: vi.fn(async () => ({ status: "ok" })),
      deletePreset: vi.fn(async () => ({ status: "ok" })),
      listAssignments: vi.fn(async () => ({
        status: "ok",
        assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
          execution_profile_id,
          preset_key: "preset-default",
          preset_display_name: "Default",
          provider_key: "openai",
          model_id: "gpt-4.1",
        })),
      })),
      updateAssignments: modelAssignmentsUpdate,
    },
  };

  return {
    http,
    deviceTokensIssue,
    deviceTokensRevoke,
    statusGet,
    usageGet,
    presenceList,
    pairingsList,
    pairingsApprove,
    pairingsDeny,
    pairingsRevoke,
    agentListGet,
    agentStatusGet,
    modelAssignmentsUpdate,
  };
}

describe("operator-ui", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not export internal mode banners from the public API", () => {
    expect("AdminModeBanner" in operatorUi).toBe(false);
    expect("ElevatedModeBanner" in operatorUi).toBe(false);
  });

  it("applies the stored theme mode when mounting OperatorUiApp", () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => (key === "tyrum.themeMode" ? "light" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock as unknown as Storage);

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

    const desktopLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-node-configure"]',
    );
    expect(desktopLink).not.toBeNull();

    await act(async () => {
      desktopLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".stack")).toBeNull();
    expect(container.querySelector(".alert")).toBeNull();

    const configureLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-configure"]',
    );
    expect(configureLink).not.toBeNull();

    act(() => {
      configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("gates navigation and non-connect routes while disconnected", () => {
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
    expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-configure"]')).toBeNull();
    expect(container.textContent).not.toContain("Connection status:");

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

  it("renders a Configure nav item and strict admin section tabs", async () => {
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
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      const configureLink = container.querySelector<HTMLButtonElement>(
        '[data-testid="nav-configure"]',
      );
      expect(configureLink).not.toBeNull();

      await act(async () => {
        configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(await waitForSelector(container, "[data-testid='configure-page']")).not.toBeNull();
      expect(container.querySelector("[data-testid='admin-tab-http']")).toBeNull();
      expect(container.querySelector("[data-testid='admin-tab-ws']")).toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='configure-tab-general']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-policy']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-providers']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-models']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-audit']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-routing-config']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-secrets']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-plugins']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-testid='configure-read-only-notice']")).toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("renders Configure section panels when Elevated Mode is active", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      expect(container.querySelector("[data-testid='admin-http-device-tokens']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-plugins");
      expect(container.querySelector("[data-testid='admin-http-plugins']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-providers");
      expect(container.querySelector("[data-testid='admin-http-providers']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-models");
      expect(container.querySelector("[data-testid='admin-http-models']")).not.toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("requires confirmation before issuing a device token from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const issueButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-device-tokens-issue"]',
      );
      expect(issueButton).not.toBeNull();

      act(() => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(true);

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();

      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(confirmButton?.disabled).toBe(false);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("requires confirmation before revoking a device token from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const deviceTokensCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-device-tokens"]',
      );
      expect(deviceTokensCard).not.toBeNull();

      const tokenInput =
        deviceTokensCard?.querySelector<HTMLInputElement>('input[type="password"]');
      expect(tokenInput).not.toBeNull();

      act(() => {
        setControlledInputValue(tokenInput!, "dev_test_token");
      });

      const revokeButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-device-tokens-revoke"]',
      );
      expect(revokeButton).not.toBeNull();

      act(() => {
        revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(true);

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();

      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(confirmButton?.disabled).toBe(false);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("disables Configure Plugins.get until a plugin id is provided", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-plugins");
      const pluginsCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-plugins"]',
      );
      expect(pluginsCard).not.toBeNull();

      const buttons = Array.from(pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const listButton = buttons.find((button) => button.textContent?.trim() === "List");
      expect(listButton).not.toBeUndefined();
      expect(listButton?.disabled).toBe(false);

      const getButton = buttons.find((button) => button.textContent?.trim() === "Get");
      expect(getButton).not.toBeUndefined();
      expect(getButton?.disabled).toBe(true);

      const pluginIdInput = pluginsCard?.querySelector<HTMLInputElement>("input");
      expect(pluginIdInput).not.toBeNull();

      await act(async () => {
        setControlledInputValue(pluginIdInput!, "echo");
        await Promise.resolve();
      });

      expect(pluginIdInput?.value).toBe("echo");

      const nextButtons = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
      const nextGetButton = nextButtons.find((button) => button.textContent?.trim() === "Get");
      expect(nextGetButton).not.toBeUndefined();
      expect(nextGetButton?.disabled).toBe(false);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("does not render the deprecated Contracts panel in Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      expect(container.querySelector('[data-testid="admin-http-contracts"]')).toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("disables Configure Plugins actions while a request is in flight", async () => {
    const listDeferred = createDeferred<Response>();
    const getDeferred = createDeferred<Response>();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "http://example.test/plugins") {
        return await listDeferred.promise;
      }

      if (url === "http://example.test/plugins/echo") {
        return await getDeferred.promise;
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      await openConfigureTab(container, "admin-http-tab-plugins");
      const pluginsCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-plugins"]',
      );
      expect(pluginsCard).not.toBeNull();

      const pluginIdInput = pluginsCard?.querySelector<HTMLInputElement>("input");
      expect(pluginIdInput).not.toBeNull();

      await act(async () => {
        setControlledInputValue(pluginIdInput!, "echo");
        await Promise.resolve();
      });

      const listButton = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "List");
      expect(listButton).not.toBeUndefined();
      expect(listButton?.disabled).toBe(false);

      const getButton = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "Get");
      expect(getButton).not.toBeUndefined();
      expect(getButton?.disabled).toBe(false);

      await act(async () => {
        listButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const buttonsDuringList = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
      const getDuringList = buttonsDuringList.find(
        (button) => button.textContent?.trim() === "Get",
      );
      expect(getDuringList).not.toBeUndefined();
      expect(getDuringList?.disabled).toBe(true);

      listDeferred.resolve(
        new Response(JSON.stringify({ status: "ok", plugins: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const getAfterList = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "Get");
      expect(getAfterList).not.toBeUndefined();
      expect(getAfterList?.disabled).toBe(false);

      await act(async () => {
        getAfterList?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const buttonsDuringGet = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
      const listDuringGet = buttonsDuringGet.find(
        (button) => button.textContent?.trim() === "List",
      );
      expect(listDuringGet).not.toBeUndefined();
      expect(listDuringGet?.disabled).toBe(true);

      getDeferred.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            plugin: { id: "echo", name: "Echo", version: "1.0.0", config_schema: {} },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const listAfterGet = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "List");
      expect(listAfterGet).not.toBeUndefined();
      expect(listAfterGet?.disabled).toBe(false);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("disables Configure model assignment save while a request is in flight", async () => {
    const refreshDeferred = createDeferred<Response>();

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const fetchMock = vi.fn(async () => await refreshDeferred.promise);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      await openConfigureTab(container, "admin-http-tab-models");
      const selects = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
      expect(selects.length).toBeGreaterThan(0);
      const saveButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="models-assignments-save"]',
      );
      expect(saveButton).not.toBeNull();
      expect(saveButton?.disabled).toBe(true);

      act(() => {
        const select = selects[0];
        if (!select) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
          ?.set as ((this: HTMLSelectElement, value: string) => void) | undefined;
        setValue?.call(select, "preset-review");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(saveButton?.disabled).toBe(false);

      await act(async () => {
        saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("http://example.test/config/models/assignments");
      expect(init?.method).toBe("PUT");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer elevated-test-token");
      expect(saveButton?.disabled).toBe(true);

      refreshDeferred.resolve(
        new Response(
          JSON.stringify({
            status: "ok",
            assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
              execution_profile_id,
              preset_key:
                execution_profile_id === "interaction" ? "preset-review" : "preset-default",
              preset_display_name: execution_profile_id === "interaction" ? "Review" : "Default",
              provider_key: "openai",
              model_id: execution_profile_id === "interaction" ? "gpt-4.1-mini" : "gpt-4.1",
            })),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(saveButton?.disabled).toBe(true);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("keeps Configure Plugins.get download filename stable after input changes", async () => {
    const { restore } = stubUrlObjectUrls();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "http://example.test/plugins/echo") {
        return new Response(
          JSON.stringify({
            status: "ok",
            plugin: { id: "echo", name: "Echo", version: "1.0.0", config_schema: {} },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const clickedDownloads: string[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === "a") {
          const anchor = element as HTMLAnchorElement;
          Object.defineProperty(anchor, "click", {
            value: () => {
              clickedDownloads.push(anchor.download);
            },
            configurable: true,
          });
        }
        return element;
      });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-plugins");
      const pluginsCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-plugins"]',
      );
      expect(pluginsCard).not.toBeNull();

      const pluginIdInput = pluginsCard?.querySelector<HTMLInputElement>("input");
      expect(pluginIdInput).not.toBeNull();

      await act(async () => {
        setControlledInputValue(pluginIdInput!, "echo");
        await Promise.resolve();
      });

      const getButton = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((button) => button.textContent?.trim() === "Get");
      expect(getButton).not.toBeUndefined();

      await act(async () => {
        getButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const downloadButton = pluginsCard?.querySelector<HTMLButtonElement>(
        "button[aria-label='Download JSON']",
      );
      expect(downloadButton).not.toBeNull();

      await act(async () => {
        setControlledInputValue(pluginIdInput!, "other");
        await Promise.resolve();
      });

      clickedDownloads.length = 0;
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(clickedDownloads).toEqual(["echo.json"]);
    } finally {
      restore();
      createElement.mockRestore();
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("requires confirmation before removing a model preset from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok", models_dev: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-models");

      const removeButtons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((button) => button.textContent?.trim() === "Remove");
      expect(removeButtons.length).toBeGreaterThanOrEqual(2);
      const removeButton = removeButtons[1];
      expect(removeButton).not.toBeUndefined();

      act(() => {
        removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(fetchMock).toHaveBeenCalledTimes(0);

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(true);

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(confirmButton?.disabled).toBe(false);

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("http://example.test/config/models/presets/preset-review");
      expect(init?.method).toBe("DELETE");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer elevated-test-token");
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("shows a friendly error when issuing a device token with an invalid TTL", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const deviceTokensCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-device-tokens"]',
      );
      expect(deviceTokensCard).not.toBeNull();

      const ttlInput = deviceTokensCard?.querySelector<HTMLInputElement>('input[type="number"]');
      expect(ttlInput).not.toBeNull();

      act(() => {
        setControlledInputValue(ttlInput!, "0");
      });

      const issueButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-device-tokens-issue"]',
      );
      expect(issueButton).not.toBeNull();

      act(() => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(false);

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = document.body.querySelector<HTMLElement>(
        '[data-testid="confirm-danger-dialog"]',
      );
      expect(dialog).not.toBeNull();

      const alert = dialog?.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Action failed");
      expect(alert?.textContent).toContain("TTL must be a positive integer");
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("connects via the primary connect action", () => {
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

    const connectButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(connectButton).not.toBeNull();

    act(() => {
      connectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.connect).toHaveBeenCalledTimes(1);
    const connectingButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="login-button"]',
    );
    expect(connectingButton).not.toBeNull();
    expect(connectingButton?.textContent).toContain("Connecting");
    expect(connectingButton?.className).toContain("bg-primary");
    expect(connectingButton?.getAttribute("aria-busy")).toBe("true");

    const cancelButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="cancel-connect-button"]',
    );
    expect(cancelButton).not.toBeNull();
    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ws.disconnect).toHaveBeenCalledTimes(1);

    expect(container.querySelector('[data-testid="disconnect-button"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("routes desktop mode to node configuration and auto-connects the local node", async () => {
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
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Node Configuration");
    expect(container.querySelector('[data-testid="nav-node-configure"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-desktop"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-connection"]')).toBeNull();

    act(() => {
      root?.unmount();
    });

    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);

    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("retries desktop node auto-connect after a raced connect resolves disconnected", async () => {
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
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi
          .fn(async () => ({ status: "connected" }))
          .mockResolvedValueOnce({ status: "disconnected" }),
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      ws.emit("disconnected", { code: 1006, reason: "transport lost" });
      await Promise.resolve();
    });

    await act(async () => {
      ws.emit("connected", { clientId: null });
      await Promise.resolve();
    });

    expect(desktopApi.node.connect).toHaveBeenCalledTimes(2);
    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(0);

    act(() => {
      root?.unmount();
    });

    expect(desktopApi.node.disconnect).toHaveBeenCalledTimes(1);

    container.remove();
    delete (window as unknown as Record<string, unknown>)["tyrumDesktop"];
  });

  it("disables node settings save while settings are saving", async () => {
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
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {
        await setConfigPromise;
      }),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
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

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Browser");
      await Promise.resolve();
    });

    await act(async () => {
      clickButtonByTestId(container, "node-capability-browser");
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.disabled).toBe(false);

    await act(async () => {
      clickButtonByTestId(container, "node-configure-save-security");
      await Promise.resolve();
    });

    const updatedSaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(updatedSaveButton).not.toBeNull();
    expect(updatedSaveButton!.disabled).toBe(true);

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

  it("does not show saving status while requesting mac permissions", async () => {
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
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
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

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Desktop");
      await Promise.resolve();
    });

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton!.textContent).toContain("Save Node Settings");

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-request-accessibility"]',
    );
    expect(requestAccessibilityButton).not.toBeNull();

    await act(async () => {
      requestAccessibilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const updatedSaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-configure-save-security"]',
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

  it("keeps mac permission request errors visible in node configuration", async () => {
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
        permissions: { profile: "balanced", overrides: {} },
        capabilities: { desktop: true, playwright: true, cli: true, http: true },
        cli: { allowedCommands: [], allowedWorkingDirs: [] },
        web: { allowedDomains: [], headless: true },
      })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped" })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
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

    await act(async () => {
      clickButtonByTestId(container, "nav-node-configure");
      await Promise.resolve();
    });

    await act(async () => {
      clickTabByLabel(container, "Desktop");
      await Promise.resolve();
    });

    const requestAccessibilityButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="node-request-accessibility"]',
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
    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

    const ws = new FakeWsClient(false);
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

  it("surfaces disconnect details on the connect page", () => {
    const ws = new FakeWsClient(false);
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
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).toContain("unauthorized");
    expect(container.textContent).toContain("4001");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("keeps the app shell visible while recovering from a transient disconnect", () => {
    vi.useFakeTimers();
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

      // Shell is visible while connected.
      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();

      act(() => {
        ws.emit("disconnected", { code: 1006, reason: "net down" });
        ws.emit("reconnect_scheduled", {
          delayMs: 20_000,
          nextRetryAtMs: Date.now() + 20_000,
          attempt: 1,
        });
      });

      // Still visible while recovering (connecting).
      expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(10_001);
      });

      // After grace expires, fall back to the connect screen but stay in a
      // visible reconnecting state if a retry is scheduled.
      expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toContain(
        "Connecting",
      );
      expect(container.querySelector('[data-testid="cancel-connect-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toMatch(
        /Connecting \(\d+s\)/,
      );

      act(() => {
        ws.emit("disconnected", { code: 1006, reason: "still down" });
      });

      // Once gated, repeated transient disconnect events should not re-show shell,
      // and should keep showing a reconnecting state on the connect page.
      expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
      expect(container.querySelector('[data-testid="login-button"]')?.textContent).toContain(
        "Connecting",
      );
      expect(container.querySelector('[data-testid="cancel-connect-button"]')).not.toBeNull();

      act(() => {
        root?.unmount();
      });
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

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
    expect(pageHeader?.className).toContain("mb-0");

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
    expect(container.textContent).toContain("Pending Pairings");

    const approvalsBadge = container.querySelector<HTMLSpanElement>(
      '[data-testid="dashboard-approvals-badge"]',
    );
    expect(approvalsBadge).not.toBeNull();
    expect(approvalsBadge?.textContent).toContain("1");
    expect(approvalsBadge?.getAttribute("aria-live")).toBeNull();
    expect(approvalsBadge?.getAttribute("aria-atomic")).toBeNull();

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

  it("supports Cmd/Ctrl+1-9/0 page navigation shortcuts across the primary routes", async () => {
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
        new KeyboardEvent("keydown", { key: "7", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="agents-tab-runs"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "9", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="configure-page"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true }),
      );
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Settings");

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

    const approvalsLiveRegion = container.querySelector<HTMLDivElement>(
      '[data-testid="approvals-pending-live"]',
    );
    expect(approvalsLiveRegion).not.toBeNull();
    expect(approvalsLiveRegion?.getAttribute("aria-live")).toBe("polite");
    expect(approvalsLiveRegion?.getAttribute("aria-atomic")).toBe("true");

    await act(async () => {
      await Promise.resolve();
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

    await act(async () => {
      await Promise.resolve();
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

    await act(async () => {
      await Promise.resolve();
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
    const toastSuccess = vi
      .spyOn(operatorUi.toast as unknown as { success: (message: string) => void }, "success")
      .mockImplementation(() => {});

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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("node-1");

    const takeoverLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="pairing-takeover-1"]',
    );
    expect(takeoverLink).not.toBeNull();
    expect(takeoverLink?.getAttribute("href")).toBe(
      "http://localhost:6080/vnc.html?autoconnect=true",
    );

    const trustRemote = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-trust-level-1-remote"]',
    );
    expect(trustRemote).not.toBeNull();
    act(() => {
      trustRemote?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const capability0 = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-capability-1-0"]',
    );
    expect(capability0).not.toBeNull();
    act(() => {
      capability0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const reason = container.querySelector<HTMLTextAreaElement>('[data-testid="pairing-reason-1"]');
    expect(reason).not.toBeNull();
    act(() => {
      if (!reason) return;
      reason.value = "ok";
      reason.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(1);
    expect(pairingsApprove).toHaveBeenCalledWith(1, {
      trust_level: "remote",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
      reason: "ok",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Pairing approved");

    const approveButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButtonAfter).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("derives pairing capability allowlist options from node capabilities", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestPendingWithNodeCapabilities()],
    });
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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const capability0 = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-capability-1-0"]',
    );
    expect(capability0).not.toBeNull();
    act(() => {
      capability0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledWith(1, {
      trust_level: "local",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not get stuck in a loading state under StrictMode when approve fails", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsApprove.mockRejectedValueOnce(new Error("nope"));
    vi.spyOn(
      operatorUi.toast as unknown as { error: (message: string) => void },
      "error",
    ).mockImplementation(() => {});

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
      root.render(
        React.createElement(React.StrictMode, null, React.createElement(PairingPage, { core })),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(1);

    const approveButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButtonAfter).not.toBeNull();
    expect(approveButtonAfter?.disabled).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("disables deny while approve is in flight", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });

    let resolveApprove: ((value: unknown) => void) | null = null;
    const approvePromise = new Promise((resolve) => {
      resolveApprove = resolve;
    });
    pairingsApprove.mockImplementationOnce(() => approvePromise as never);

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
      root.render(React.createElement(PairingPage, { core }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const denyButtonWhileBusy = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-deny-1"]',
    );
    expect(denyButtonWhileBusy).not.toBeNull();
    expect(denyButtonWhileBusy?.disabled).toBe(true);

    await act(async () => {
      resolveApprove?.({ status: "ok", pairing: samplePairingRequestApproved() });
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("labels pairing groups with fieldset legends", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });

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
      root.render(React.createElement(PairingPage, { core }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const legends = Array.from(container.querySelectorAll("legend")).map((node) =>
      (node.textContent ?? "").trim(),
    );
    expect(legends.some((text) => text.includes("Trust level"))).toBe(true);
    expect(legends.some((text) => text.includes("Capabilities"))).toBe(true);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders pairing empty state when no pending requests", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [] });

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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No pairing requests");
    expect(container.textContent).toContain(
      "Pairing requests appear when devices want to connect.",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("denies pairing requests with toast feedback", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsDeny } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsDeny.mockResolvedValueOnce({
      status: "ok",
      pairing: {
        ...samplePairingRequestPending(),
        status: "denied",
        resolution: {
          decision: "denied",
          resolved_at: "2026-01-01T00:00:01.000Z",
          reason: "no",
        },
        resolved_at: "2026-01-01T00:00:01.000Z",
      },
    });
    const toastSuccess = vi
      .spyOn(operatorUi.toast as unknown as { success: (message: string) => void }, "success")
      .mockImplementation(() => {});

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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);

    const denyButton = container.querySelector<HTMLButtonElement>('[data-testid="pairing-deny-1"]');
    expect(denyButton).not.toBeNull();

    await act(async () => {
      denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsDeny).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Pairing denied");

    const denyButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-deny-1"]',
    );
    expect(denyButtonAfter).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders approved pairings with a revoke button", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsRevoke } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestApproved()],
    });
    pairingsRevoke.mockResolvedValueOnce({
      status: "ok",
      pairing: {
        ...samplePairingRequestApproved(),
        status: "revoked",
        resolution: {
          decision: "revoked",
          resolved_at: "2026-01-01T00:00:02.000Z",
          reason: "revoked",
        },
        resolved_at: "2026-01-01T00:00:02.000Z",
      },
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

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);

    const revokeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-revoke-1"]',
    );
    expect(revokeButton).not.toBeNull();

    await act(async () => {
      revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsRevoke).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders incoming runs on the agent runs tab", async () => {
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

    const agentsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-agents"]');
    expect(agentsLink).not.toBeNull();

    await act(async () => {
      agentsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const runsTab = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="agents-tab-runs"]',
    );

    act(() => {
      runsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    expect(container.textContent).toContain("No runs yet");
    expect(container.textContent).toContain(
      "Runs for this agent appear here when it starts executing.",
    );

    act(() => {
      ws.emit("run.updated", { payload: { run: sampleExecutionRun() } });
    });

    const runStatusBadge = container.querySelector<HTMLSpanElement>(
      `[data-testid="run-status-${sampleExecutionRun().run_id}"]`,
    );
    expect(runStatusBadge).not.toBeNull();
    expect(runStatusBadge?.textContent).toContain("running");
    expect(runStatusBadge?.getAttribute("aria-live")).toBe("polite");
    expect(runStatusBadge?.getAttribute("aria-atomic")).toBe("true");
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

  it("renders theme and update cards in Configure general", async () => {
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

    await openConfigureGeneral(container);

    expect(container.querySelector('[data-testid="configure-general-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="configure-theme"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="configure-update"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("switches theme mode from Configure general", async () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => (key === "tyrum.themeMode" ? "dark" : null)),
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

    await openConfigureGeneral(container);

    const lightOption = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-theme-light"]',
    );
    expect(lightOption).not.toBeNull();

    await act(async () => {
      lightOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows an Elevated Mode frame and allows exit", () => {
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

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    act(() => {
      core.elevatedModeStore.enter({ elevatedToken: "elevated-token", expiresAt: null });
    });

    const frame = container.querySelector('[data-testid="elevated-mode-frame"]');
    expect(frame).not.toBeNull();

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-exit"]',
    );
    expect(exitButton).not.toBeNull();

    act(() => {
      exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("gates an admin-only Configure action behind Elevated Mode", async () => {
    const expectedScopes = [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ];

    const ws = new FakeWsClient();
    const { http, deviceTokensIssue } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await openConfigureTab(container, "admin-http-tab-gateway");

    const issueButtonBeforeElevated = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-http-device-tokens-issue"]',
    );
    expect(issueButtonBeforeElevated).not.toBeNull();
    expect(issueButtonBeforeElevated?.disabled).toBe(true);
    expect(container.textContent).toContain("Enter Elevated Mode to enable mutation actions.");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-read-only-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(deviceTokensIssue).toHaveBeenCalledWith({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
      scopes: expectedScopes,
      ttl_seconds: 60 * 10,
    });
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();

    const commandsTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-tab-commands"]',
    );
    expect(commandsTab).not.toBeNull();

    await act(async () => {
      commandsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const commandInput = container.querySelector<HTMLInputElement>(
      '[data-testid="admin-ws-command-input"]',
    );
    expect(commandInput).not.toBeNull();
    act(() => {
      commandInput!.value = "/help";
      commandInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const executeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-command-run"]',
    );
    expect(executeButton).not.toBeNull();

    await act(async () => {
      executeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.commandExecute).toHaveBeenCalledWith("/help");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("uses a provided elevated mode controller to enter persistent mode and persist it", async () => {
    const { session, local } = stubPersistentStorage();

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {
        core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });
      }),
      exit: vi.fn(async () => {
        core.elevatedModeStore.exit();
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(controller.enter).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    const persistedRaw = session.get("tyrum.operator-ui.elevated-mode.v1");
    expect(persistedRaw).toBeTruthy();
    expect(JSON.parse(persistedRaw!)).toEqual({
      httpBaseUrl: "http://example.test",
      deviceId: TEST_DEVICE_IDENTITY.deviceId,
      elevatedToken: "persistent-token",
      expiresAt: null,
    });
    expect(local.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rehydrates persistent elevated mode from sessionStorage when a controller is present", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "restored-token",
        expiresAt: null,
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(controller.enter).not.toHaveBeenCalled();
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "restored-token",
      expiresAt: null,
    });
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears current-session persistent elevated mode on unauthorized disconnect", async () => {
    const { session } = stubPersistentStorage();

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {
        core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });
      }),
      exit: vi.fn(async () => {
        core.elevatedModeStore.exit();
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "persistent-token",
      expiresAt: null,
    });
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(true);

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears restored persistent elevated mode on unauthorized disconnect", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "restored-token",
        expiresAt: null,
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears persistent elevated mode when the controller becomes available after a 4001 disconnect", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "restored-token",
        expiresAt: null,
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({ elevatedToken: "restored-token", expiresAt: null });

    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    await act(async () => {
      ws.emit("disconnected", { code: 4001, reason: "unauthorized" });
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(true);

    await act(async () => {
      root?.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("migrates legacy web persistence from localStorage into sessionStorage", async () => {
    const local = new Map<string, string>();
    local.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "legacy-token",
        expiresAt: null,
      }),
    );
    const { session } = stubPersistentStorage({ local });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement("div", null, "child"),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "legacy-token",
      expiresAt: null,
    });
    expect(session.get("tyrum.operator-ui.elevated-mode.v1")).toBeTruthy();
    expect(local.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears invalid persisted elevated mode state during restore", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "bad-token",
        expiresAt: "not-an-iso-date",
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("clears expired persisted elevated mode state during restore", async () => {
    const session = new Map<string, string>();
    session.set(
      "tyrum.operator-ui.elevated-mode.v1",
      JSON.stringify({
        httpBaseUrl: "http://example.test",
        deviceId: TEST_DEVICE_IDENTITY.deviceId,
        elevatedToken: "expired-token",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    stubPersistentStorage({ session });

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {}),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("button", { type: "button", "data-testid": "danger-action" }, "Go"),
          ),
        ),
      );
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(session.has("tyrum.operator-ui.elevated-mode.v1")).toBe(false);
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("keeps elevated mode active and shows a toast when controller exit fails", async () => {
    const toastError = vi.spyOn(toast, "error");
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({ elevatedToken: "persistent-token", expiresAt: null });

    const controller = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {
        throw new Error("revoke failed");
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          {
            core,
            mode: "web",
            elevatedModeController: controller,
          },
          React.createElement("div", null, "child"),
        ),
      );
      await Promise.resolve();
    });

    const exitButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-exit"]',
    );
    expect(exitButton).not.toBeNull();

    await act(async () => {
      exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(controller.exit).toHaveBeenCalledTimes(1);
    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(toastError).toHaveBeenCalledWith("revoke failed");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("uses baseline bearer auth to enter Elevated Mode", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(issuedAt));

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
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
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
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
    expect(container.textContent).toContain("Enter Elevated Mode to continue");

    const enterButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="elevated-mode-dialog"]');
    expect(dialog).not.toBeNull();

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const issueCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoToUrl(input).endsWith("/auth/device-tokens/issue"),
    );
    expect(issueCalls).toHaveLength(1);
    const [, callInit] = issueCalls[0] ?? [];
    const headers = new Headers(callInit?.headers);
    expect(callInit?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer baseline");
    expect(JSON.parse(String(callInit?.body))).toMatchObject({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
    });
    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "active",
      elevatedToken: "elevated-device-token",
      expiresAt,
    });

    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("rejects a timed fallback Elevated Mode token without expires_at", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
          role: "client",
          scopes: ["operator.admin"],
          issued_at: issuedAt,
          expires_at: null,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
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
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
    expect(container.querySelector('[data-testid="elevated-mode-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="danger-action"]')).toBeNull();
    expect(document.body.textContent).toContain(
      "Gateway returned a timed elevated-mode token without expires_at.",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("uses baseline cookie auth to enter Elevated Mode in web mode", async () => {
    const issuedAt = "2026-02-27T00:00:00.000Z";
    const expiresAt = "2026-02-27T00:10:00.000Z";
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "elevated-device-token",
          token_id: "token-1",
          device_id: TEST_DEVICE_IDENTITY.deviceId,
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
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBrowserCookieAuth(),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
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
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.querySelector<HTMLInputElement>(
      '[data-testid="elevated-mode-confirm"]',
    );
    expect(confirmCheckbox).not.toBeNull();
    act(() => {
      confirmCheckbox!.checked = true;
      confirmCheckbox!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="elevated-mode-submit"]',
    );
    expect(submitButton).not.toBeNull();

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const issueCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoToUrl(input).endsWith("/auth/device-tokens/issue"),
    );
    expect(issueCalls).toHaveLength(1);
    const [, callInit] = issueCalls[0] ?? [];
    const headers = new Headers(callInit?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(callInit?.credentials).toBe("include");
    expect(JSON.parse(String(callInit?.body))).toMatchObject({
      device_id: TEST_DEVICE_IDENTITY.deviceId,
      role: "client",
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders an accessible Elevated Mode dialog and closes on Escape", () => {
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
        React.createElement(ElevatedModeProvider, {
          core,
          mode: "web",
          children: React.createElement(
            ElevatedModeGate,
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
      '[data-testid="elevated-mode-enter"]',
    );
    expect(enterButton).not.toBeNull();

    act(() => {
      enterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector('[data-testid="elevated-mode-dialog"]');
    expect(dialog).not.toBeNull();

    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();

    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
