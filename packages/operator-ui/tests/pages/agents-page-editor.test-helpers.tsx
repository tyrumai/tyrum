import { AgentConfig, IdentityPack, type ManagedExtensionDetail } from "@tyrum/contracts";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { act, type Mock } from "react";
import { vi } from "vitest";
import { setNativeValue } from "../test-utils.js";

export function sampleManagedAgentDetail(agentKey: string) {
  return {
    agent_id:
      agentKey === "default"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    agent_key: agentKey,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    has_config: true,
    has_identity: true,
    is_primary: agentKey === "default",
    can_delete: agentKey !== "default",
    persona: {
      name: agentKey === "default" ? "Default Agent" : "Agent One",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        style: { tone: "direct" },
      },
    }),
  };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function findLabeledControl(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = Array.from(container.querySelectorAll("label")).find(
    (element) => element.textContent?.trim() === labelText,
  );
  if (!(label instanceof HTMLLabelElement) || !label.htmlFor) {
    throw new Error(`Missing label: ${labelText}`);
  }
  const control = container.ownerDocument.getElementById(label.htmlFor);
  if (
    !(
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    )
  ) {
    throw new Error(`Missing control for label: ${labelText}`);
  }
  return control;
}

export function setLabeledValue(container: HTMLElement, labelText: string, value: string): void {
  const control = findLabeledControl(container, labelText);
  if (control instanceof HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(control, value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  setNativeValue(control, value);
}

export function samplePresets() {
  return {
    status: "ok" as const,
    presets: [
      {
        preset_id: "33333333-3333-4333-8333-333333333333",
        preset_key: "claude-opus-4-6-high",
        display_name: "Claude Opus 4.6 High",
        provider_key: "openrouter",
        model_id: "anthropic/claude-opus-4.6",
        options: { reasoning_effort: "high" as const },
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
      {
        preset_id: "44444444-4444-4444-8444-444444444444",
        preset_key: "gpt-5-4",
        display_name: "GPT-5.4",
        provider_key: "openrouter",
        model_id: "openai/gpt-5.4",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    ],
  };
}

export function sampleMcpExtensionDetail(
  key: string,
  overrides: Partial<ManagedExtensionDetail> = {},
): ManagedExtensionDetail {
  if (key === "memory") {
    return {
      kind: "mcp",
      key: "memory",
      name: "Memory",
      description: null,
      version: null,
      enabled: true,
      revision: null,
      source: null,
      source_type: "builtin",
      refreshable: false,
      materialized_path: null,
      assignment_count: 0,
      transport: "stdio",
      default_access: "inherit",
      can_edit_settings: true,
      can_toggle_source_enabled: false,
      can_refresh_source: false,
      can_revert_source: false,
      manifest: null,
      spec: {
        id: "memory",
        name: "Memory",
        enabled: true,
        transport: "stdio",
        command: "node",
        args: ["-e", ""],
      },
      files: [],
      revisions: [],
      default_mcp_server_settings_json: {
        enabled: true,
        semantic: { enabled: true, limit: 9 },
      },
      default_mcp_server_settings_yaml: `enabled: true
semantic:
  enabled: true
  limit: 9
`,
      sources: [
        {
          source_type: "builtin",
          is_effective: true,
          enabled: true,
          revision: null,
          refreshable: false,
          materialized_path: null,
          transport: "stdio",
          version: null,
          description: null,
          source: null,
        },
      ],
      ...overrides,
    };
  }

  return {
    kind: "mcp",
    key,
    name: "Filesystem",
    description: null,
    version: null,
    enabled: true,
    revision: 1,
    source: {
      kind: "npm",
      npm_spec: "@modelcontextprotocol/server-filesystem",
      command: "npx",
      args: ["-y"],
    },
    source_type: "managed",
    refreshable: true,
    materialized_path: "/tmp/managed/mcp/filesystem/server.yml",
    assignment_count: 0,
    transport: "stdio",
    default_access: "inherit",
    can_edit_settings: true,
    can_toggle_source_enabled: true,
    can_refresh_source: true,
    can_revert_source: true,
    manifest: null,
    spec: {
      id: key,
      name: "Filesystem",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    },
    files: ["server.yml"],
    revisions: [],
    default_mcp_server_settings_json: {
      namespace: "shared",
    },
    default_mcp_server_settings_yaml: "namespace: shared\n",
    sources: [
      {
        source_type: "managed",
        is_effective: true,
        enabled: true,
        revision: 1,
        refreshable: true,
        materialized_path: "/tmp/managed/mcp/filesystem/server.yml",
        transport: "stdio",
        version: null,
        description: null,
        source: {
          kind: "npm",
          npm_spec: "@modelcontextprotocol/server-filesystem",
          command: "npx",
          args: ["-y"],
        },
      },
    ],
    ...overrides,
  };
}

export function createCore(
  list: Mock,
  get: Mock,
  capabilities: Mock,
  update: Mock,
  listPresets = vi.fn().mockResolvedValue(samplePresets()),
  extensions = {
    list: vi.fn().mockResolvedValue({
      items: [sampleMcpExtensionDetail("memory"), sampleMcpExtensionDetail("filesystem")],
    }),
    get: vi.fn(async (_kind: "mcp", key: string) => ({
      item: sampleMcpExtensionDetail(key),
    })),
    parseMcpSettings: vi.fn(async ({ settings_text }: { settings_text: string }) => ({
      settings: JSON.parse(JSON.stringify({ raw: settings_text })),
    })),
  },
) {
  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  });
  const { store: statusStore } = createStore({
    status: { conversations: null },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const { store: agentStatusStore } = createStore({
    agentKey: "missing-agent",
    status: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: turnsStore } = createStore({
    turnsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByTurnId: {},
    attemptIdsByStepId: {},
    agentKeyByTurnId: {},
  });
  const { store: transcriptStoreBase } = createStore({
    agentKey: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    conversations: [],
    nextCursor: null as string | null,
    selectedConversationKey: null as string | null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  });
  const transcriptStore = {
    ...transcriptStoreBase,
    setAgentKey: vi.fn(),
    setChannel: vi.fn(),
    setActiveOnly: vi.fn(),
    setArchived: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    openConversation: vi.fn().mockResolvedValue(undefined),
    clearDetail: vi.fn(),
  };

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    http: {
      agents: { list, get, capabilities, create: vi.fn(), update, delete: vi.fn() },
      modelConfig: {
        listPresets,
      },
      extensions,
    },
    turnsStore,
    transcriptStore,
    chatSocket: {
      connected: true,
      requestDynamic: vi.fn(),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    },
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
}
