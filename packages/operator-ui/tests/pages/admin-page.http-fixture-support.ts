import { vi } from "vitest";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";

export const TEST_TIMESTAMP = "2026-03-01T00:00:00.000Z";
export const ADMIN_HTTP_EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export type ExecutionProfileId = (typeof ADMIN_HTTP_EXECUTION_PROFILE_IDS)[number];

export type ModelPresetFixture = {
  preset_id: string;
  preset_key: string;
  display_name: string;
  provider_key: string;
  model_id: string;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AvailableModelFixture = {
  provider_key: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string | null;
  reasoning: boolean;
  tool_call: boolean;
  modalities: { output: string[] };
};

export type ModelAssignmentFixture = {
  execution_profile_id: string;
  preset_key: string | null;
  preset_display_name: string | null;
  provider_key: string | null;
  model_id: string | null;
};

export function createModelPreset(overrides: Partial<ModelPresetFixture> = {}): ModelPresetFixture {
  return {
    preset_id: "00000000-0000-4000-8000-000000000001",
    preset_key: "preset-default",
    display_name: "Default",
    provider_key: "openai",
    model_id: "gpt-4.1",
    options: {},
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createAvailableModel(
  overrides: Partial<AvailableModelFixture> = {},
): AvailableModelFixture {
  return {
    provider_key: "openai",
    provider_name: "OpenAI",
    model_id: "gpt-4.1",
    model_name: "GPT-4.1",
    family: null,
    reasoning: true,
    tool_call: true,
    modalities: { output: ["text"] },
    ...overrides,
  };
}

export function createModelAssignment(
  executionProfileId: ExecutionProfileId,
  preset: Pick<
    ModelPresetFixture,
    "preset_key" | "display_name" | "provider_key" | "model_id"
  > | null,
): ModelAssignmentFixture {
  return {
    execution_profile_id: executionProfileId,
    preset_key: preset?.preset_key ?? null,
    preset_display_name: preset?.display_name ?? null,
    provider_key: preset?.provider_key ?? null,
    model_id: preset?.model_id ?? null,
  };
}

export function createAssignmentsForAllProfiles(
  preset: Pick<ModelPresetFixture, "preset_key" | "display_name" | "provider_key" | "model_id">,
): ModelAssignmentFixture[] {
  return ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((executionProfileId) =>
    createModelAssignment(executionProfileId, preset),
  );
}

export function createUnassignedAssignmentsForAllProfiles(): ModelAssignmentFixture[] {
  return ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((executionProfileId) =>
    createModelAssignment(executionProfileId, null),
  );
}

export function createAdminHttpTestCore(): {
  core: OperatorCore;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  routingConfigRevert: ReturnType<typeof vi.fn>;
  secretsRotate: ReturnType<typeof vi.fn>;
  policyCreateOverride: ReturnType<typeof vi.fn>;
  locationUpdateProfile: ReturnType<typeof vi.fn>;
  locationCreatePlace: ReturnType<typeof vi.fn>;
  locationUpdatePlace: ReturnType<typeof vi.fn>;
  locationDeletePlace: ReturnType<typeof vi.fn>;
} {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(TEST_TIMESTAMP),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:01:00.000Z",
  });

  const routingConfigUpdate = vi.fn(async () => ({ revision: 1, config: { v: 1 } }) as unknown);
  const routingConfigRevert = vi.fn(async () => ({ revision: 2, config: { v: 1 } }) as unknown);
  const secretsRotate = vi.fn(async () => ({ revoked: true, handle: {} }) as unknown);
  const policyCreateOverride = vi.fn(async () => ({ status: "ok" }) as unknown);
  const locationUpdateProfile = vi.fn(
    async () =>
      ({
        status: "ok",
        profile: {
          primary_node_id: "mobile-node-1",
          poi_provider_key: "geoapify",
          updated_at: TEST_TIMESTAMP,
        },
      }) as unknown,
  );
  const locationCreatePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place: {
          place_id: "place-created",
          name: "Home",
          latitude: 52.3676,
          longitude: 4.9041,
          radius_m: 100,
          tags: ["home"],
          source: "manual",
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      }) as unknown,
  );
  const locationUpdatePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place: {
          place_id: "place-home",
          name: "Home",
          latitude: 52.3676,
          longitude: 4.9041,
          radius_m: 100,
          tags: ["home"],
          source: "manual",
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      }) as unknown,
  );
  const locationDeletePlace = vi.fn(
    async () =>
      ({
        status: "ok",
        place_id: "place-home",
        deleted: true,
      }) as unknown,
  );

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    http: {
      nodes: {
        list: vi.fn(async () => ({
          status: "ok",
          generated_at: TEST_TIMESTAMP,
          nodes: [
            {
              node_id: "mobile-node-1",
              label: "iPhone 15",
              connected: true,
              paired_status: "approved",
              attached_to_requested_lane: false,
              capabilities: [],
            },
            {
              node_id: "mobile-node-2",
              label: "Android test phone",
              connected: true,
              paired_status: "approved",
              attached_to_requested_lane: false,
              capabilities: [],
            },
          ],
        })),
      },
      policy: {
        getBundle: vi.fn(
          async () =>
            ({
              status: "ok",
              generated_at: TEST_TIMESTAMP,
              effective: {
                sha256: "policy-sha-1",
                bundle: {
                  v: 1,
                  tools: {
                    default: "require_approval",
                    allow: ["read"],
                    require_approval: [],
                    deny: [],
                  },
                  network_egress: {
                    default: "require_approval",
                    allow: [],
                    require_approval: [],
                    deny: [],
                  },
                  secrets: {
                    default: "require_approval",
                    allow: [],
                    require_approval: [],
                    deny: [],
                  },
                  connectors: {
                    default: "require_approval",
                    allow: ["telegram:*"],
                    require_approval: [],
                    deny: [],
                  },
                  artifacts: { default: "allow" },
                  provenance: { untrusted_shell_requires_approval: true },
                },
                sources: {
                  deployment: "default",
                  agent: null,
                  playbook: null,
                },
              },
            }) as unknown,
        ),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] }) as unknown),
        createOverride: policyCreateOverride,
        revokeOverride: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      policyConfig: {
        getDeployment: vi.fn(async () => {
          throw new TyrumHttpClientError("http_error", "not found", {
            status: 404,
            error: "not_found",
          });
        }),
        listDeploymentRevisions: vi.fn(async () => ({ revisions: [] }) as unknown),
        updateDeployment: vi.fn(
          async (input: { bundle: unknown; reason?: string }) =>
            ({
              revision: 1,
              agent_key: null,
              bundle: input.bundle,
              created_at: TEST_TIMESTAMP,
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: input.reason,
              reverted_from_revision: null,
            }) as unknown,
        ),
        revertDeployment: vi.fn(
          async (input: { revision: number; reason?: string }) =>
            ({
              revision: input.revision + 1,
              agent_key: null,
              bundle: {
                v: 1,
                tools: {
                  default: "require_approval",
                  allow: ["read"],
                  require_approval: [],
                  deny: [],
                },
              },
              created_at: TEST_TIMESTAMP,
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: input.reason,
              reverted_from_revision: input.revision,
            }) as unknown,
        ),
      },
      agents: {
        list: vi.fn(
          async () =>
            ({
              agents: [
                {
                  agent_id: "00000000-0000-4000-8000-000000000002",
                  agent_key: "default",
                  created_at: TEST_TIMESTAMP,
                  updated_at: TEST_TIMESTAMP,
                  has_config: true,
                  has_identity: true,
                  can_delete: false,
                  persona: {
                    name: "Default Agent",
                    description: "Primary operator",
                    tone: "Direct",
                    palette: "neutral",
                    character: "operator",
                  },
                },
              ],
            }) as unknown,
        ),
      },
      authProfiles: {
        list: vi.fn(async () => ({ status: "ok", profiles: [] }) as unknown),
        create: vi.fn(async () => ({ status: "ok" }) as unknown),
        update: vi.fn(async () => ({ status: "ok" }) as unknown),
        disable: vi.fn(async () => ({ status: "ok" }) as unknown),
        enable: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      authPins: {
        list: vi.fn(async () => ({ status: "ok", pins: [] }) as unknown),
        set: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      agentList: {
        get: vi.fn(async () => ({
          agents: [
            {
              agent_key: "default",
              agent_id: "agent-1",
              has_config: true,
              persona: {
                name: "Default",
                description: "Default agent",
                tone: "direct",
                palette: "blue",
                character: "pragmatic",
              },
            },
            {
              agent_key: "agent-b",
              agent_id: "agent-2",
              has_config: true,
              persona: {
                name: "Agent B",
                description: "Agent B",
                tone: "direct",
                palette: "green",
                character: "pragmatic",
              },
            },
          ],
        })),
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
        listProviders: vi.fn(async () => ({ status: "ok", providers: [] }) as unknown),
        createAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        updateAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteProvider: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      routingConfig: {
        get: vi.fn(async () => ({
          revision: 1,
          config: {
            v: 1,
            telegram: {
              accounts: {
                default: {
                  default_agent_key: "default",
                  threads: { "tg-123": "agent-b" },
                },
                ops: {},
              },
            },
          },
        })),
        listRevisions: vi.fn(async () => ({
          revisions: [
            {
              revision: 1,
              config: {
                v: 1,
                telegram: {
                  accounts: {
                    default: {
                      default_agent_key: "default",
                      threads: { "tg-123": "agent-b" },
                    },
                    ops: {},
                  },
                },
              },
              created_at: TEST_TIMESTAMP,
            },
          ],
        })),
        listObservedTelegramThreads: vi.fn(async () => ({
          threads: [
            {
              channel: "telegram",
              account_key: "default",
              thread_id: "tg-123",
              container_kind: "group",
              session_title: "Support room",
              last_active_at: TEST_TIMESTAMP,
            },
            {
              channel: "telegram",
              account_key: "default",
              thread_id: "tg-456",
              container_kind: "dm",
              session_title: "Direct chat",
              last_active_at: TEST_TIMESTAMP,
            },
            {
              channel: "telegram",
              account_key: "ops",
              thread_id: "tg-123",
              container_kind: "group",
              session_title: "Ops mirror",
              last_active_at: TEST_TIMESTAMP,
            },
          ],
        })),
        listChannelConfigs: vi.fn(async () => ({
          channels: [
            {
              channel: "telegram",
              account_key: "default",
              bot_token_configured: true,
              webhook_secret_configured: true,
              allowed_user_ids: ["123"],
              pipeline_enabled: true,
            },
            {
              channel: "telegram",
              account_key: "ops",
              bot_token_configured: false,
              webhook_secret_configured: true,
              allowed_user_ids: ["555", "777"],
              pipeline_enabled: false,
            },
          ],
        })),
        createChannelConfig: vi.fn(async () => ({
          config: {
            channel: "telegram",
            account_key: "ops",
            bot_token_configured: true,
            webhook_secret_configured: true,
            allowed_user_ids: ["123"],
            pipeline_enabled: true,
          },
        })),
        update: routingConfigUpdate,
        updateChannelConfig: vi.fn(async () => ({
          config: {
            channel: "telegram",
            account_key: "default",
            bot_token_configured: true,
            webhook_secret_configured: true,
            allowed_user_ids: ["123"],
            pipeline_enabled: true,
          },
        })),
        deleteChannelConfig: vi.fn(async () => ({
          deleted: true,
          channel: "telegram",
          account_key: "default",
        })),
        revert: routingConfigRevert,
      },
      toolRegistry: {
        list: vi.fn(async () => ({
          status: "ok",
          tools: [
            {
              source: "builtin",
              canonical_id: "read",
              description: "Read files from disk.",
              risk: "low",
              requires_confirmation: false,
              effective_exposure: { enabled: true, reason: "enabled", agent_key: "default" },
              keywords: ["read", "file"],
            },
            {
              source: "builtin_mcp",
              canonical_id: "websearch",
              description: "Search the web via Exa.",
              risk: "medium",
              requires_confirmation: true,
              effective_exposure: { enabled: true, reason: "enabled", agent_key: "default" },
              backing_server: {
                id: "exa",
                name: "Exa",
                transport: "remote",
                url: "https://mcp.exa.ai/mcp",
              },
            },
            {
              source: "plugin",
              canonical_id: "plugin.echo.say",
              description: "Echo text back to the caller.",
              risk: "low",
              requires_confirmation: false,
              effective_exposure: {
                enabled: false,
                reason: "disabled_by_agent_allowlist",
                agent_key: "default",
              },
              plugin: { id: "echo", name: "Echo", version: "0.0.1" },
            },
          ],
        })),
      },
      secrets: {
        store: vi.fn(async () => ({ handle: {} }) as unknown),
        list: vi.fn(async () => ({ handles: [] }) as unknown),
        rotate: secretsRotate,
        revoke: vi.fn(async () => ({ revoked: true }) as unknown),
      },
      modelConfig: {
        listPresets: vi.fn(async () => ({ status: "ok", presets: [] }) as unknown),
        listAvailable: vi.fn(async () => ({ status: "ok", models: [] }) as unknown),
        createPreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        updatePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        deletePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        listAssignments: vi.fn(
          async () =>
            ({
              status: "ok",
              assignments: createAssignmentsForAllProfiles(createModelPreset()),
            }) as unknown,
        ),
        updateAssignments: vi.fn(async () => ({ status: "ok", assignments: [] }) as unknown),
      },
      location: {
        listPlaces: vi.fn(
          async () =>
            ({
              status: "ok",
              places: [
                {
                  place_id: "place-home",
                  name: "Home",
                  latitude: 52.3676,
                  longitude: 4.9041,
                  radius_m: 100,
                  tags: ["home"],
                  source: "manual",
                  created_at: TEST_TIMESTAMP,
                  updated_at: TEST_TIMESTAMP,
                },
              ],
            }) as unknown,
        ),
        createPlace: locationCreatePlace,
        updatePlace: locationUpdatePlace,
        deletePlace: locationDeletePlace,
        getProfile: vi.fn(
          async () =>
            ({
              status: "ok",
              profile: {
                primary_node_id: "mobile-node-1",
                poi_provider_key: "geoapify",
                updated_at: TEST_TIMESTAMP,
              },
            }) as unknown,
        ),
        updateProfile: locationUpdateProfile,
      },
    },
  } as unknown as OperatorCore;

  return {
    core,
    routingConfigUpdate,
    routingConfigRevert,
    secretsRotate,
    policyCreateOverride,
    locationUpdateProfile,
    locationCreatePlace,
    locationUpdatePlace,
    locationDeletePlace,
  };
}
