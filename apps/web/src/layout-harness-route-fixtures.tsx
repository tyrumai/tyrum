import { createElevatedModeStore, createStore, type OperatorCore } from "@tyrum/operator-app";
import type { DesktopApi } from "@tyrum/operator-ui";
import {
  createActivityStore,
  createAgentStatusStore,
  createApprovalsStore,
  createConnectionStore,
  createEventWsStub,
  createManagedAgentDetail,
  createPairingStore,
  createTurnsStore,
  createStatusStore,
  createWorkboardStore,
} from "./layout-harness-store-fixtures.js";
import { createAiSdkChatWsStub } from "./layout-harness-chat-fixtures.js";
import { createChatStore } from "./layout-harness-chat-store-fixtures.js";
import { createHarnessAgentHttpFixtures } from "./layout-harness-agent-http-fixtures.js";
import { createHarnessConfigureHttpFixtures } from "./layout-harness-configure-http-fixtures.js";

function createJsonDesktopHttpResponse(body: unknown) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    bodyText: JSON.stringify(body),
  };
}

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
      conversations: {},
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
  return ["interaction", "explorer_ro", "reviewer_ro", "planner", "jury", "executor_rw"].map(
    (execution_profile_id) => ({
      execution_profile_id,
      preset_key: null,
      preset_display_name: null,
      provider_key: null,
      model_id: null,
    }),
  );
}

function createOnboardingRegistry() {
  return [
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
              description: "Primary secret used for the provider account.",
              kind: "secret" as const,
              input: "password" as const,
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
}

function createOnboardingHttpFixtures() {
  const onboardingRegistry = createOnboardingRegistry();

  return {
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
  };
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

export function createOnboardingDesktopApi(): DesktopApi {
  const fixtures = createOnboardingHttpFixtures();

  return {
    ...createDesktopApi(),
    gateway: {
      ...createDesktopApi().gateway,
      httpFetch: async ({ url }) => {
        const requestUrl = new URL(url, "http://127.0.0.1:8788");
        const pathname = requestUrl.pathname;

        if (pathname.endsWith("/config/providers/registry")) {
          return createJsonDesktopHttpResponse(await fixtures.providerConfig.listRegistry());
        }
        if (pathname.endsWith("/config/providers")) {
          return createJsonDesktopHttpResponse(await fixtures.providerConfig.listProviders());
        }
        if (pathname.endsWith("/config/models/presets/available")) {
          return createJsonDesktopHttpResponse(await fixtures.modelConfig.listAvailable());
        }
        if (pathname.endsWith("/config/models/presets")) {
          return createJsonDesktopHttpResponse(await fixtures.modelConfig.listPresets());
        }
        if (pathname.endsWith("/config/models/assignments")) {
          return createJsonDesktopHttpResponse(await fixtures.modelConfig.listAssignments());
        }
        if (pathname.endsWith("/config/agents/default")) {
          return createJsonDesktopHttpResponse(await fixtures.agentConfig.get());
        }

        return {
          status: 404,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({
            error: "not_found",
            message: `Unhandled onboarding fixture request: ${pathname}`,
          }),
        };
      },
    },
  } satisfies DesktopApi;
}

export function createAgentsCore(): OperatorCore {
  const rootConversation = {
    conversation_id: "550e8400-e29b-41d4-a716-446655440101",
    conversation_key: "agent:default:ui:default:channel:thread-root-1",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root-1",
    title: "Default Agent conversation",
    message_count: 2,
    updated_at: "2026-03-08T00:05:00.000Z",
    created_at: "2026-03-08T00:00:00.000Z",
    archived: false,
    latest_turn_id: null,
    latest_turn_status: null,
    has_active_turn: false,
    pending_approval_count: 0,
  };
  const childConversation = {
    conversation_id: "550e8400-e29b-41d4-a716-446655440102",
    conversation_key: "agent:default:subagent:550e8400-e29b-41d4-a716-446655440099",
    agent_key: "default",
    channel: "subagent",
    thread_id: "thread-child-1",
    title: "Delegated child",
    message_count: 1,
    updated_at: "2026-03-08T00:04:00.000Z",
    created_at: "2026-03-08T00:01:00.000Z",
    archived: false,
    parent_conversation_key: rootConversation.conversation_key,
    subagent_id: "550e8400-e29b-41d4-a716-446655440099",
    execution_profile: "executor",
    subagent_status: "running" as const,
    latest_turn_id: null,
    latest_turn_status: null,
    has_active_turn: false,
    pending_approval_count: 0,
  };
  const transcriptStoreState = createStore({
    agentKey: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    conversations: [rootConversation, childConversation],
    nextCursor: null as string | null,
    selectedConversationKey: rootConversation.conversation_key as string | null,
    detail: {
      rootConversationKey: rootConversation.conversation_key,
      focusConversationKey: rootConversation.conversation_key,
      conversations: [rootConversation, childConversation],
      events: [
        {
          event_id: "message:conversation-root-1:msg-1",
          kind: "message" as const,
          occurred_at: "2026-03-08T00:00:10.000Z",
          conversation_key: rootConversation.conversation_key,
          payload: {
            message: {
              id: "msg-1",
              role: "user" as const,
              parts: [{ type: "text" as const, text: "Inspect the retained transcript." }],
            },
          },
        },
      ],
    },
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  });
  const core = {
    httpBaseUrl: "http://127.0.0.1:8788/",
    elevatedModeStore: createElevatedModeStore(),
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    agentStatusStore: createAgentStatusStore(),
    turnsStore: createTurnsStore(),
    transcriptStore: {
      ...transcriptStoreState.store,
      setAgentKey() {},
      setChannel() {},
      setActiveOnly() {},
      setArchived() {},
      async refresh() {},
      async loadMore() {},
      async openConversation() {},
      clearDetail() {},
    },
    chatSocket: {
      connected: true,
      requestDynamic: async () => ({}),
      onDynamicEvent: () => {},
      offDynamicEvent: () => {},
    },
    http: createHarnessAgentHttpFixtures(createManagedAgentDetail),
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}

export function createDashboardCore(): OperatorCore {
  const transcriptStoreState = createStore({
    agentKey: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    conversations: [] as unknown[],
    nextCursor: null as string | null,
    selectedConversationKey: null as string | null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  });
  const core = {
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    turnsStore: createTurnsStore(),
    transcriptStore: {
      ...transcriptStoreState.store,
      setAgentKey() {},
      setChannel() {},
      setActiveOnly() {},
      setArchived() {},
      async refresh() {},
      async loadMore() {},
      async openConversation() {},
      clearDetail() {},
    },
    chatStore: createChatStore(),
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
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}

export function createChatCore(): OperatorCore {
  const core = {
    connectionStore: createConnectionStore(),
    approvalsStore: createApprovalsStore(),
    chatStore: createChatStore(),
    ws: createAiSdkChatWsStub(),
    http: {
      agents: {
        list: async () => ({
          agents: [{ agent_key: "default" }],
        }),
      },
    },
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
    ws: OperatorCore["chatSocket"] & OperatorCore["workboard"];
  };
  core.admin = core.http;
  core.chatSocket = core.ws;
  core.workboard = core.ws;
  return core;
}

export function createApprovalsCore(): OperatorCore {
  return {
    elevatedModeStore: createElevatedModeStore(),
    approvalsStore: createApprovalsStore(),
    pairingStore: createPairingStore(),
    turnsStore: createTurnsStore(),
  } as unknown as OperatorCore;
}

export function createPairingCore(): OperatorCore {
  const core = {
    elevatedModeStore: createElevatedModeStore(),
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
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}

export function createWorkboardCore(): OperatorCore {
  const core = {
    connectionStore: createConnectionStore(),
    workboardStore: createWorkboardStore(),
    ws: {
      ...createEventWsStub(),
    },
    http: {
      agents: {
        list: async () => ({
          agents: [{ agent_key: "default", persona: { name: "Default Agent" } }],
        }),
      },
    },
    connect() {},
    disconnect() {},
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
    ws: OperatorCore["chatSocket"] & OperatorCore["workboard"];
  };
  core.admin = core.http;
  core.chatSocket = core.ws;
  core.workboard = core.ws;
  return core;
}

export function createConfigureCore(): OperatorCore {
  const core = {
    elevatedModeStore: createElevatedModeStore(),
    http: createHarnessConfigureHttpFixtures(),
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}

export function createOnboardingCore(): OperatorCore {
  const elevatedModeStore = createElevatedModeStore();
  elevatedModeStore.enter({
    elevatedToken: "layout-harness-elevated-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const fixtures = createOnboardingHttpFixtures();

  const core = {
    httpBaseUrl: "http://127.0.0.1:8788/",
    elevatedModeStore,
    statusStore: createOnboardingStatusStore(),
    http: fixtures,
    syncAllNow: async () => {},
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}
