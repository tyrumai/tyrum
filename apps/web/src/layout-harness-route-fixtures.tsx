import {
  createElevatedModeStore,
  type OperatorCore,
} from "../../../packages/operator-core/src/index.js";
import type { DesktopApi } from "../../../packages/operator-ui/src/desktop-api.js";
import { createActivityFixtureStore } from "./layout-harness-activity-fixtures.js";
import {
  createAgentStatusStore,
  createApprovalsStore,
  createChatStore,
  createConnectionStore,
  createEventWsStub,
  createManagedAgentDetail,
  createMemoryStore,
  createPairingStore,
  createRunsStore,
  createStatusStore,
  createWorkboardStore,
} from "./layout-harness-store-fixtures.js";

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
    connectionStore: createConnectionStore(),
    statusStore: createStatusStore(),
    agentStatusStore: createAgentStatusStore(),
    memoryStore: createMemoryStore(),
    runsStore: createRunsStore(),
    http: {
      agents: {
        list: async () => ({
          agents: [
            {
              agent_key: "default",
              agent_id: "11111111-1111-4111-8111-111111111111",
              can_delete: false,
              persona: { name: "Default Agent" },
            },
            {
              agent_key: "agent-1",
              agent_id: "22222222-2222-4222-8222-222222222222",
              can_delete: true,
              persona: { name: "Agent One" },
            },
          ],
        }),
        get: async (agentKey: string) => createManagedAgentDetail(agentKey),
        create: async () => createManagedAgentDetail("agent-1"),
        update: async (agentKey: string) => createManagedAgentDetail(agentKey),
        delete: async () => ({ deleted: true }),
      },
    },
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
  } as unknown as OperatorCore;
}

export function createChatCore(): OperatorCore {
  return {
    connectionStore: createConnectionStore(),
    chatStore: createChatStore(),
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
    pairingStore: createPairingStore(),
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
  const elevatedModeStore = createElevatedModeStore();
  const configuredProviders = {
    providers: [
      {
        provider_key: "openai",
        name: "OpenAI",
        doc: null,
        supported: true,
        accounts: [],
      },
    ],
  };
  const presetList = {
    status: "ok",
    presets: [
      {
        preset_id: "preset-1",
        preset_key: "preset-default",
        display_name: "Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    ],
  };
  const assignments = {
    status: "ok",
    assignments: [
      {
        execution_profile_id: "default",
        preset_key: "preset-default",
        preset_display_name: "Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
      },
    ],
  };

  return {
    elevatedModeStore,
    http: {
      authTokens: {
        list: async () => ({ tokens: [] }),
        issue: async () => ({ status: "ok", token: "secret" }),
        revoke: async () => ({ status: "ok" }),
      },
      deviceTokens: {
        issue: async () => ({ status: "ok", token: "device-token" }),
        revoke: async () => ({ status: "ok" }),
      },
      policy: {
        getBundle: async () => ({ status: "ok", bundle: { version: 1 } }),
        listOverrides: async () => ({ status: "ok", overrides: [] }),
        createOverride: async () => ({ status: "ok" }),
        revokeOverride: async () => ({ status: "ok" }),
      },
      providerConfig: {
        listRegistry: async () => ({
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
        }),
        listProviders: async () => configuredProviders,
        createAccount: async () => ({ status: "ok" }),
        updateAccount: async () => ({ status: "ok" }),
        deleteAccount: async () => ({ status: "ok" }),
        deleteProvider: async () => ({ status: "ok" }),
      },
      modelConfig: {
        listPresets: async () => presetList,
        listAvailable: async () => ({
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
          ],
        }),
        createPreset: async () => ({ status: "ok" }),
        updatePreset: async () => ({ status: "ok" }),
        deletePreset: async () => ({ status: "ok" }),
        listAssignments: async () => assignments,
        updateAssignments: async () => ({ status: "ok", assignments: assignments.assignments }),
      },
      routingConfig: {
        get: async () => ({ status: "ok", config: { v: 1 } }),
        update: async () => ({ status: "ok" }),
        revert: async () => ({ status: "ok" }),
      },
      secrets: {
        list: async () => ({ status: "ok", handles: [] }),
        store: async () => ({ status: "ok" }),
        rotate: async () => ({ status: "ok" }),
        revoke: async () => ({ status: "ok" }),
      },
      audit: {
        export: async () => ({ status: "ok", rows: [] }),
        verify: async () => ({ status: "ok", verified: true }),
        forget: async () => ({ status: "ok" }),
      },
      plugins: {
        list: async () => ({ plugins: [{ id: "echo", version: "1.0.0" }] }),
        get: async () => ({ id: "echo", version: "1.0.0", description: "Test plugin" }),
      },
    },
  } as unknown as OperatorCore;
}

export function createActivityCore(): OperatorCore {
  return {
    activityStore: createActivityFixtureStore(),
    statusStore: createStatusStore(),
    http: {
      agents: {
        get: async (agentKey: string) => createManagedAgentDetail(agentKey),
      },
      agentConfig: {
        update: async (agentKey: string) => ({
          config: createManagedAgentDetail(agentKey).config,
          revision: 2,
        }),
      },
    },
  } as unknown as OperatorCore;
}
