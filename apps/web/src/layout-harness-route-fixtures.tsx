import {
  createElevatedModeStore,
  type OperatorCore,
} from "../../../packages/operator-core/src/index.js";
import { createStore } from "../../../packages/operator-core/src/store.js";
import type { DesktopApi } from "../../../packages/operator-ui/src/desktop-api.js";
import {
  createActivityStore,
  createAgentStatusStore,
  createApprovalsStore,
  createChatStore,
  createConnectionStore,
  createEventWsStub,
  createManagedAgentDetail,
  createPairingStore,
  createRunsStore,
  createStatusStore,
  createWorkboardStore,
} from "./layout-harness-store-fixtures.js";
import { createAiSdkChatWsStub } from "./layout-harness-chat-fixtures.js";
import { createHarnessAgentHttpFixtures } from "./layout-harness-agent-http-fixtures.js";
import { createHarnessConfigureHttpFixtures } from "./layout-harness-configure-http-fixtures.js";

function createNodeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "embedded",
    embedded: { port: 8788 },
    permissions: { profile: "balanced", overrides: {} },
    capabilities: { desktop: true, playwright: true, cli: true, http: true },
    cli: { allowedCommands: [], allowedWorkingDirs: [] },
    web: { allowedDomains: [], headless: true },
    ...overrides,
  };
}

function createOnboardingStatusStore() {
  return createStore({
    status: {
      status: "ok" as const,
      version: "1.0.0",
      instance_id: "layout-harness",
      role: "all" as const,
      db_kind: "sqlite" as const,
      is_exposed: false,
      otel_enabled: false,
      auth: { enabled: true },
      ws: null,
      policy: null,
      model_auth: null,
      catalog_freshness: null,
      session_lanes: {},
      queue_depth: null,
      sandbox: null,
      config_health: {
        status: "issues" as const,
        issues: [
          {
            code: "no_provider_accounts" as const,
            severity: "error" as const,
            message: "No active provider accounts are configured.",
            target: { kind: "deployment" as const, id: null },
          },
        ],
      },
    },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: "2026-03-08T00:00:00.000Z",
  }).store;
}

function createOnboardingAgentConfigResponse() {
  return {
    revision: 1,
    tenant_id: "tenant-1",
    agent_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    config: {
      model: { model: null },
      persona: {
        name: "Default Agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      memory: {
        enabled: true,
        strategy: "summary",
      },
      instructions: "",
      mcp: {
        pre_turn_tools: [],
        server_settings: {},
      },
    },
    persona: {
      name: "Default Agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config_sha256: "e".repeat(64),
    created_at: "2026-03-01T00:00:00.000Z",
    created_by: { kind: "tenant.token" as const, token_id: "token-1" },
    reason: null,
    reverted_from_revision: null,
  };
}

function createUnassignedAssignments() {
  return [
    "interaction",
    "explorer_ro",
    "reviewer_ro",
    "planner",
    "jury",
    "executor_rw",
    "integrator",
  ].map((execution_profile_id) => ({
    execution_profile_id,
    preset_key: null,
    preset_display_name: null,
    provider_key: null,
    model_id: null,
  }));
}

export function createDesktopApi(): DesktopApi {
  const config = createNodeConfig();
  return {
    getConfig: async () => config,
    setConfig: async () => {},
    gateway: {
      getStatus: async () => ({ status: "running", port: 8788 }),
      start: async () => ({ status: "running", port: 8788 }),
      stop: async () => ({ status: "stopped" }),
      getOperatorConnection: async () => ({
        mode: "embedded",
        wsUrl: "ws://127.0.0.1:8788/ws",
        httpBaseUrl: "http://127.0.0.1:8788/",
        token: "tyrum-token.v1.embedded.token",
        tlsCertFingerprint256: "",
        tlsAllowSelfSigned: false,
      }),
    },
    node: {
      connect: async () => ({ status: "connected" }),
      disconnect: async () => ({ status: "disconnected" }),
    },
    onStatusChange: () => () => {},
  } satisfies DesktopApi;
}

export function createAgentsCore(): OperatorCore {
  return {
    httpBaseUrl: "http://127.0.0.1:8788/",
    elevatedModeStore: createElevatedModeStore(),
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    agentStatusStore: createAgentStatusStore(),
    runsStore: createRunsStore(),
    http: createHarnessAgentHttpFixtures(createManagedAgentDetail),
  } as unknown as OperatorCore;
}

export function createDashboardCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    runsStore: createRunsStore(),
    workboardStore: createWorkboardStore(),
    activityStore: createActivityStore(),
    http: {
      nodes: {
        list: async () => ({
          status: "ok",
          generated_at: "2026-03-08T00:00:00.000Z",
          nodes: [],
        }),
      },
    },
  } as unknown as OperatorCore;
}

export function createChatCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    approvalsStore: createApprovalsStore(),
    chatStore: createChatStore(),
    ws: createAiSdkChatWsStub(),
    http: {
      agents: {
        list: async () => ({
          agents: [{ agent_id: "default" }],
        }),
      },
    },
  } as unknown as OperatorCore;
}

export function createApprovalsCore(): OperatorCore {
  return {
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    runsStore: createRunsStore(),
  } as unknown as OperatorCore;
}

export function createPairingCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    chatStore: createChatStore(),
    pairingStore: createPairingStore(),
    http: {
      nodes: {
        list: async () => ({
          status: "ok",
          generated_at: "2026-03-08T00:00:00.000Z",
          nodes: [],
        }),
      },
    },
  } as unknown as OperatorCore;
}

export function createWorkboardCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    workboardStore: createWorkboardStore(),
    ws: {
      ...createEventWsStub(),
    },
    connect() {},
    disconnect() {},
  } as unknown as OperatorCore;
}

export function createConfigureCore(): OperatorCore {
  return {
    elevatedModeStore: createElevatedModeStore(),
    http: createHarnessConfigureHttpFixtures(),
  } as unknown as OperatorCore;
}

export function createOnboardingCore(): OperatorCore {
  const elevatedModeStore = createElevatedModeStore();
  elevatedModeStore.enter({
    elevatedToken: "layout-harness-elevated-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });

  const onboardingRegistry = [
    {
      provider_key: "openai",
      name: "OpenAI",
      doc: null,
      supported: true,
      accounts: [],
      methods: [
        {
          method_key: "api_key",
          label: "API key",
          type: "api_key",
          fields: [
            {
              key: "api_key",
              label: "API key",
              description: "Primary secret used for the provider account.",
              kind: "secret",
              input: "password",
              required: true,
            },
            ...Array.from({ length: 12 }, (_, index) => ({
              key: `config_${String(index + 1)}`,
              label: `Config field ${String(index + 1)}`,
              description:
                "Extra fixture field to force the onboarding provider step to scroll within its card body.",
              kind: "config" as const,
              input: "text" as const,
              required: false,
            })),
          ],
        },
      ],
    },
  ];

  return {
    httpBaseUrl: "http://127.0.0.1:8788/",
    elevatedModeStore,
    statusStore: createOnboardingStatusStore(),
    http: {
      providerConfig: {
        listRegistry: async () => ({ status: "ok" as const, providers: onboardingRegistry }),
        listProviders: async () => ({ status: "ok" as const, providers: [] }),
      },
      modelConfig: {
        listPresets: async () => ({ status: "ok" as const, presets: [] }),
        listAvailable: async () => ({ status: "ok" as const, models: [] }),
        listAssignments: async () => ({
          status: "ok" as const,
          assignments: createUnassignedAssignments(),
        }),
      },
      agentConfig: {
        get: async () => createOnboardingAgentConfigResponse(),
      },
    },
    syncAllNow: async () => {},
  } as unknown as OperatorCore;
}
