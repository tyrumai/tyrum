import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { vi } from "vitest";
import type { OperatorHttpClient } from "../../operator-core/src/deps.js";
import {
  createAuthTokenHttpFixtures,
  createDeviceTokenHttpFixtures,
} from "./operator-ui.token-http-fixtures.js";
import {
  sampleAgentStatusResponse,
  sampleApprovalApproved,
  sampleApprovalPending,
  sampleExecutionAttempt,
  sampleExecutionRun,
  sampleExecutionStep,
  samplePairingRequestApproved,
  samplePairingRequestPending,
  samplePairingRequestPendingWithNodeCapabilities,
  sampleNodeInventoryResponse,
  samplePresenceResponse,
  sampleStatusResponse,
  sampleUsageResponse,
} from "./operator-ui.data-fixtures.js";
import {
  createModelConfigHttpFixtures,
  createProviderConfigHttpFixtures,
} from "./operator-ui.admin-http-fixtures.js";
import {
  sampleDesktopEnvironment,
  sampleDesktopEnvironmentHost,
} from "./operator-ui.desktop-environment-fixtures.js";
import { createExtensionsHttpFixtures } from "./operator-ui.extensions-http-fixtures.js";
export { FakeWsClient } from "./operator-ui.ws-test-fixtures.js";

export type {
  SampleExecutionAttemptStatus,
  SampleExecutionStepStatus,
} from "./operator-ui.test-support.js";

export {
  sampleStatusResponse,
  sampleUsageResponse,
  sampleAgentStatusResponse,
  samplePresenceResponse,
  sampleNodeInventoryResponse,
  samplePairingRequestPending,
  samplePairingRequestPendingWithNodeCapabilities,
  samplePairingRequestApproved,
  sampleApprovalPending,
  sampleApprovalApproved,
  sampleExecutionRun,
  sampleExecutionStep,
  sampleExecutionAttempt,
};

function sampleManagedAgentDetail(agentKey: string) {
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
        style: {
          tone: "direct",
        },
      },
    }),
    config_revision: 1,
    identity_revision: 1,
    config_sha256: "a".repeat(64),
    identity_sha256: "b".repeat(64),
  };
}

export function createFakeHttpClient(): {
  http: OperatorHttpClient;
  authTokensList: ReturnType<typeof vi.fn>;
  authTokensIssue: ReturnType<typeof vi.fn>;
  authTokensUpdate: ReturnType<typeof vi.fn>;
  authTokensRevoke: ReturnType<typeof vi.fn>;
  deviceTokensIssue: ReturnType<typeof vi.fn>;
  deviceTokensRevoke: ReturnType<typeof vi.fn>;
  statusGet: ReturnType<typeof vi.fn>;
  usageGet: ReturnType<typeof vi.fn>;
  presenceList: ReturnType<typeof vi.fn>;
  nodesList: ReturnType<typeof vi.fn>;
  pairingsList: ReturnType<typeof vi.fn>;
  pairingsGet: ReturnType<typeof vi.fn>;
  pairingsApprove: ReturnType<typeof vi.fn>;
  pairingsDeny: ReturnType<typeof vi.fn>;
  pairingsRevoke: ReturnType<typeof vi.fn>;
  agentListGet: ReturnType<typeof vi.fn>;
  agentStatusGet: ReturnType<typeof vi.fn>;
  agentConfigGet: ReturnType<typeof vi.fn>;
  agentConfigUpdate: ReturnType<typeof vi.fn>;
  modelAssignmentsUpdate: ReturnType<typeof vi.fn>;
} {
  const { authTokensList, authTokensIssue, authTokensUpdate, authTokensRevoke } =
    createAuthTokenHttpFixtures();
  const { deviceTokensIssue, deviceTokensRevoke } = createDeviceTokenHttpFixtures();
  const providerConfig = createProviderConfigHttpFixtures();
  const { modelConfig, modelAssignmentsUpdate } = createModelConfigHttpFixtures();
  const extensions = createExtensionsHttpFixtures();
  const statusGet = vi.fn(async () => sampleStatusResponse());
  const usageGet = vi.fn(async () => sampleUsageResponse());
  const presenceList = vi.fn(async () => samplePresenceResponse());
  const nodesList = vi.fn(async () => sampleNodeInventoryResponse());
  const pairingsList = vi.fn(
    async () => ({ status: "ok", pairings: [samplePairingRequestPending()] }) as const,
  );
  const pairingsGet = vi.fn(
    async () => ({ status: "ok", pairing: samplePairingRequestPending() }) as const,
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
  let defaultAgentConfig = {
    revision: 1,
    tenant_id: "tenant-1",
    agent_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: "Default Agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    persona: {
      name: "Default Agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config_sha256: "c".repeat(64),
    created_at: "2026-03-01T00:00:00.000Z",
    created_by: { kind: "tenant.token", token_id: "token-1" },
    reason: null,
    reverted_from_revision: null,
  } as const;
  const agentConfigList = vi.fn(
    async () =>
      ({
        agents: [
          {
            agent_id: defaultAgentConfig.agent_id,
            agent_key: defaultAgentConfig.agent_key,
            created_at: defaultAgentConfig.created_at,
            updated_at: defaultAgentConfig.created_at,
            has_config: true,
            persona: defaultAgentConfig.persona,
          },
        ],
      }) as const,
  );
  const agentConfigGet = vi.fn(async () => defaultAgentConfig);
  const agentConfigUpdate = vi.fn(
    async (
      agentKey: string,
      input: { config: typeof defaultAgentConfig.config; reason?: string },
    ) => {
      defaultAgentConfig = {
        ...defaultAgentConfig,
        agent_key: agentKey,
        revision: defaultAgentConfig.revision + 1,
        config: AgentConfig.parse(input.config),
        config_sha256: "d".repeat(64),
        reason: input.reason ?? null,
      };
      return defaultAgentConfig;
    },
  );
  const desktopEnvironmentHostsList = vi.fn(
    async () => ({ status: "ok", hosts: [sampleDesktopEnvironmentHost()] }) as const,
  );
  const desktopEnvironmentsList = vi.fn(
    async () => ({ status: "ok", environments: [sampleDesktopEnvironment()] }) as const,
  );
  const desktopEnvironmentsGetDefaults = vi.fn(
    async () =>
      ({
        status: "ok",
        default_image_ref: "ghcr.io/rhernaus/tyrum-desktop-sandbox:stable",
        revision: 1,
        created_at: "2026-03-10T12:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: null,
        reverted_from_revision: null,
      }) as const,
  );
  const desktopEnvironmentsUpdateDefaults = vi.fn(
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
  );
  const policyGetBundle = vi.fn(
    async () =>
      ({
        status: "ok",
        generated_at: "2026-03-01T00:00:00.000Z",
        effective: {
          sha256: "policy-sha-1",
          bundle: {
            v: 1,
            tools: { default: "require_approval", allow: ["read"], require_approval: [], deny: [] },
            network_egress: {
              default: "require_approval",
              allow: [],
              require_approval: [],
              deny: [],
            },
            secrets: { default: "require_approval", allow: [], require_approval: [], deny: [] },
            connectors: {
              default: "require_approval",
              allow: ["telegram:*"],
              require_approval: [],
              deny: [],
            },
            artifacts: { default: "allow" },
            provenance: { untrusted_shell_requires_approval: true },
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
      }) as const,
  );
  const policyListOverrides = vi.fn(async () => ({ overrides: [] }) as const);
  const policyCreateOverride = vi.fn(async () => ({ override: {} }) as const);
  const policyRevokeOverride = vi.fn(async () => ({ override: {} }) as const);
  const policyConfigGetDeployment = vi.fn(async () => {
    throw new TyrumHttpClientError("http_error", "not found", {
      status: 404,
      error: "not_found",
    });
  });
  const policyConfigListDeploymentRevisions = vi.fn(async () => ({ revisions: [] }) as const);
  const policyConfigUpdateDeployment = vi.fn(
    async (input: { bundle: unknown; reason?: string }) =>
      ({
        revision: 1,
        agent_key: null,
        bundle: input.bundle,
        created_at: "2026-03-01T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: null,
      }) as const,
  );
  const policyConfigRevertDeployment = vi.fn(
    async (input: { revision: number; reason?: string }) =>
      ({
        revision: 2,
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
        created_at: "2026-03-01T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: input.revision,
      }) as const,
  );
  const agentsList = vi.fn(
    async () =>
      ({
        agents: [
          {
            agent_id: "00000000-0000-4000-8000-000000000002",
            agent_key: "default",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            has_config: true,
            has_identity: true,
            can_delete: false,
            persona: {
              name: "Default Agent",
              tone: "Direct",
              palette: "neutral",
              character: "operator",
            },
          },
        ],
      }) as const,
  );
  const agentsGet = vi.fn(async (agentKey: string) => sampleManagedAgentDetail(agentKey));
  const agentsCapabilities = vi.fn(async () => ({
    skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
    mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
    tools: { default_mode: "allow", allow: [], deny: [], items: [] },
  }));
  const agentsCreate = vi.fn(async (input: { agent_key: string }) =>
    sampleManagedAgentDetail(input.agent_key),
  );
  const agentsUpdate = vi.fn(async (agentKey: string) => sampleManagedAgentDetail(agentKey));
  const agentsDelete = vi.fn(async (agentKey: string) => ({
    agent_id:
      agentKey === "default"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    agent_key: agentKey,
    deleted: true,
  }));
  const toolRegistryList = vi.fn(
    async () =>
      ({
        status: "ok",
        tools: [
          {
            source: "builtin",
            canonical_id: "read",
            description: "Read files from disk.",
            effect: "read_only",
            effective_exposure: { enabled: true, reason: "enabled" },
          },
          {
            source: "plugin",
            canonical_id: "connector.send",
            description: "Send via a connector.",
            effect: "state_changing",
            effective_exposure: { enabled: true, reason: "enabled" },
          },
        ],
      }) as const,
  );

  const http: OperatorHttpClient = {
    authTokens: {
      list: authTokensList,
      issue: authTokensIssue,
      update: authTokensUpdate,
      revoke: authTokensRevoke,
    },
    deviceTokens: {
      issue: deviceTokensIssue,
      revoke: deviceTokensRevoke,
    },
    status: { get: statusGet },
    usage: { get: usageGet },
    presence: { list: presenceList },
    nodes: { list: nodesList },
    agentStatus: { get: agentStatusGet },
    agentList: { get: agentListGet },
    desktopEnvironmentHosts: {
      list: desktopEnvironmentHostsList,
    },
    desktopEnvironments: {
      list: desktopEnvironmentsList,
      getDefaults: desktopEnvironmentsGetDefaults,
      get: vi.fn(async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const),
      create: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      updateDefaults: desktopEnvironmentsUpdateDefaults,
      update: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      start: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      stop: vi.fn(
        async () =>
          ({
            status: "ok",
            environment: {
              ...sampleDesktopEnvironment(),
              status: "stopped",
              desired_running: false,
            },
          }) as const,
      ),
      reset: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
      remove: vi.fn(async () => ({ status: "ok", deleted: true }) as const),
      logs: vi.fn(
        async () =>
          ({
            status: "ok",
            environment_id: "env-1",
            logs: ["booting runtime", "runtime ready"],
          }) as const,
      ),
    },
    pairings: {
      list: pairingsList,
      get: pairingsGet,
      approve: pairingsApprove,
      deny: pairingsDeny,
      revoke: pairingsRevoke,
    },
    providerConfig,
    modelConfig,
    extensions,
    policy: {
      getBundle: policyGetBundle,
      listOverrides: policyListOverrides,
      createOverride: policyCreateOverride,
      revokeOverride: policyRevokeOverride,
    },
    policyConfig: {
      getDeployment: policyConfigGetDeployment,
      listDeploymentRevisions: policyConfigListDeploymentRevisions,
      updateDeployment: policyConfigUpdateDeployment,
      revertDeployment: policyConfigRevertDeployment,
    },
    agents: {
      list: agentsList,
      get: agentsGet,
      capabilities: agentsCapabilities,
      create: agentsCreate,
      update: agentsUpdate,
      delete: agentsDelete,
    },
    agentConfig: {
      list: agentConfigList,
      get: agentConfigGet,
      update: agentConfigUpdate,
    },
    toolRegistry: {
      list: toolRegistryList,
    },
  };

  return {
    http,
    authTokensList,
    authTokensIssue,
    authTokensUpdate,
    authTokensRevoke,
    deviceTokensIssue,
    deviceTokensRevoke,
    statusGet,
    usageGet,
    presenceList,
    nodesList,
    pairingsList,
    pairingsGet,
    pairingsApprove,
    pairingsDeny,
    pairingsRevoke,
    agentListGet,
    agentStatusGet,
    agentConfigGet,
    agentConfigUpdate,
    modelAssignmentsUpdate,
  };
}
