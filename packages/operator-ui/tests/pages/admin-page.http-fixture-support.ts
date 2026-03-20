import { vi } from "vitest";
import { TyrumHttpClientError } from "@tyrum/operator-app/browser";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-app/src/index.js";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import { createChannelAndRoutingFixtures } from "./admin-page.http-channel-fixture-support.js";
import { createLocationFixture } from "./admin-page.http-location-fixture-support.js";
import {
  TEST_TIMESTAMP,
  createAssignmentsForAllProfiles,
  createModelPreset,
} from "./admin-page.http.models.shared.js";

export {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  TEST_TIMESTAMP,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
} from "./admin-page.http.models.shared.js";
export type {
  AvailableModelFixture,
  ExecutionProfileId,
  ModelAssignmentFixture,
  ModelPresetFixture,
} from "./admin-page.http.models.shared.js";

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
  const { channelConfig, routingConfig } = createChannelAndRoutingFixtures({
    testTimestamp: TEST_TIMESTAMP,
    routingConfigUpdate,
    routingConfigRevert,
  });
  const {
    locationUpdateProfile,
    locationCreatePlace,
    locationUpdatePlace,
    locationDeletePlace,
    locationApi,
  } = createLocationFixture(TEST_TIMESTAMP);

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
                  is_primary: true,
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
              agent_id: "00000000-0000-4000-8000-000000000001",
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
              agent_id: "00000000-0000-4000-8000-000000000002",
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
      channelConfig,
      routingConfig,
      toolRegistry: {
        list: vi.fn(async () => ({
          status: "ok",
          tools: [
            {
              source: "builtin",
              canonical_id: "read",
              description: "Read files from disk.",
              effect: "read_only",
              effective_exposure: { enabled: true, reason: "enabled", agent_key: "default" },
              keywords: ["read", "file"],
            },
            {
              source: "builtin_mcp",
              canonical_id: "websearch",
              description: "Search the web via Exa.",
              effect: "state_changing",
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
              effect: "read_only",
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
      location: locationApi,
    },
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;

  stubAdminHttpFetch(core);

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
