import { vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { sampleManagedAgentDetail } from "../operator-ui.agent-test-fixtures.js";

export function sampleAgentStatus() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: { name: "Default Agent" },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
    },
    skills: ["review"],
    skills_detailed: [{ id: "review", name: "Review", version: "1.0.0", source: "bundled" }],
    workspace_skills_trusted: true,
    mcp: [],
    tools: ["shell"],
    sessions: {
      ttl_days: 365,
      max_turns: 0,
      loop_detection: {
        within_turn: { enabled: true, consecutive_repeat_limit: 3, cycle_repeat_limit: 3 },
        cross_turn: {
          enabled: true,
          window_assistant_messages: 3,
          similarity_threshold: 0.97,
          min_chars: 120,
          cooldown_assistant_messages: 6,
        },
      },
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
    },
  } as const;
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function samplePresets() {
  return {
    status: "ok" as const,
    presets: [
      {
        preset_id: "33333333-3333-4333-8333-333333333333",
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

export function sampleAvailableModels() {
  return {
    status: "ok" as const,
    models: [
      {
        provider_key: "openrouter",
        provider_name: "OpenRouter",
        model_id: "openai/gpt-5.4",
        model_name: "GPT-5.4",
        family: "GPT-5",
        reasoning: true,
        tool_call: true,
        modalities: { output: ["text"] },
      },
    ],
  };
}

export function sampleRegistry() {
  return {
    status: "ok" as const,
    providers: [
      {
        provider_key: "openrouter",
        name: "OpenRouter",
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
  };
}

export function sampleConfiguredProviders() {
  return {
    status: "ok" as const,
    providers: [
      {
        provider_key: "openrouter",
        name: "OpenRouter",
        doc: null,
        supported: true,
        accounts: [
          {
            account_id: "33333333-3333-4333-8333-333333333334",
            account_key: "openrouter-primary",
            provider_key: "openrouter",
            display_name: "OpenRouter",
            method_key: "api_key",
            type: "api_key",
            status: "active",
            config: {},
            configured_secret_keys: ["api_key"],
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

export function createCore(options?: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  listPresets?: ReturnType<typeof vi.fn>;
  createPreset?: ReturnType<typeof vi.fn>;
  listAvailableModels?: ReturnType<typeof vi.fn>;
  listRegistry?: ReturnType<typeof vi.fn>;
  listProviders?: ReturnType<typeof vi.fn>;
  createProviderAccount?: ReturnType<typeof vi.fn>;
  updateAgentPolicy?: ReturnType<typeof vi.fn>;
}) {
  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  });
  const { store: statusStore } = createStore({
    status: { session_lanes: null },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const { store: agentStatusStore, setState: setAgentStatusState } = createStore({
    agentKey: "missing-agent",
    status: sampleAgentStatus(),
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: runsStore } = createStore({
    runsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
  });

  const setAgentKey = vi.fn((agentKey: string) => {
    setAgentStatusState((prev) => ({ ...prev, agentKey }));
  });
  const refresh = vi.fn().mockResolvedValue(undefined);

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: { ...agentStatusStore, setAgentKey, refresh },
    http: {
      agents: {
        list: options?.list ?? vi.fn().mockResolvedValue({ agents: [] }),
        get: options?.get ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        capabilities: vi.fn(async () => ({
          skills: {
            default_mode: "allow",
            allow: [],
            deny: [],
            workspace_trusted: true,
            items: [],
          },
          mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
          tools: { default_mode: "allow", allow: [], deny: [], items: [] },
        })),
        create: options?.create ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        update: options?.update ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        delete: options?.remove ?? vi.fn().mockResolvedValue({ deleted: true }),
      },
      providerConfig: {
        listRegistry: options?.listRegistry ?? vi.fn().mockResolvedValue(sampleRegistry()),
        listProviders:
          options?.listProviders ?? vi.fn().mockResolvedValue(sampleConfiguredProviders()),
        createAccount:
          options?.createProviderAccount ?? vi.fn().mockResolvedValue({ status: "ok" }),
      },
      modelConfig: {
        listPresets: options?.listPresets ?? vi.fn().mockResolvedValue(samplePresets()),
        createPreset:
          options?.createPreset ??
          vi.fn().mockResolvedValue({ preset: samplePresets().presets[0] }),
        listAvailable:
          options?.listAvailableModels ?? vi.fn().mockResolvedValue(sampleAvailableModels()),
      },
      policyConfig: {
        updateAgent: options?.updateAgentPolicy ?? vi.fn().mockResolvedValue({}),
      },
      extensions: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        get: vi.fn(),
        parseMcpSettings: vi.fn(),
      },
    },
    runsStore,
  } as unknown as OperatorCore & { http: OperatorCore["admin"] };
  core.admin = core.http;

  return { core, setAgentKey, refresh };
}

export { sampleManagedAgentDetail };
