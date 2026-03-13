import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { vi } from "vitest";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-core/src/deps.js";
import type { Handler } from "./operator-ui.test-support.js";
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
  samplePresenceResponse,
  sampleStatusResponse,
  sampleUsageResponse,
} from "./operator-ui.data-fixtures.js";
import {
  createModelConfigHttpFixtures,
  createProviderConfigHttpFixtures,
} from "./operator-ui.admin-http-fixtures.js";
import { sampleNodeInventoryResponse } from "./operator-ui.http-fixture-data.js";
import { createExtensionsHttpFixtures } from "./operator-ui.extensions-http-fixtures.js";

export class FakeWsClient implements OperatorWsClient {
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
  workList = vi.fn(async () => ({ items: [] }) as unknown);
  sessionList = vi.fn(async () => ({ sessions: [], next_cursor: null }));
  sessionGet = vi.fn(async () => ({
    session: {
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      title: "",
      summary: "",
      transcript: [],
      updated_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  }));
  sessionCreate = vi.fn(async () => ({
    session_id: "session-1",
    agent_id: "default",
    channel: "ui",
    thread_id: "ui-session-1",
    title: "",
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

export type {
  SampleExecutionAttemptStatus,
  SampleExecutionStepStatus,
} from "./operator-ui.test-support.js";

export {
  sampleStatusResponse,
  sampleUsageResponse,
  sampleAgentStatusResponse,
  samplePresenceResponse,
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

function sampleDesktopEnvironmentHost() {
  return {
    host_id: "host-1",
    label: "Primary runtime",
    version: "0.1.0",
    docker_available: true,
    healthy: true,
    last_seen_at: "2026-03-10T12:00:00.000Z",
    last_error: null,
  } as const;
}

function sampleDesktopEnvironment() {
  return {
    environment_id: "env-1",
    host_id: "host-1",
    label: "Research desktop",
    image_ref: "registry.example.test/desktop@sha256:1234",
    managed_kind: "docker",
    status: "running",
    desired_running: true,
    node_id: "node-desktop-1",
    takeover_url: "http://127.0.0.1:8788/desktop-environments/env-1/takeover",
    last_seen_at: "2026-03-10T12:00:00.000Z",
    last_error: null,
    created_at: "2026-03-10T12:00:00.000Z",
    updated_at: "2026-03-10T12:00:00.000Z",
  } as const;
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
  pairingsApprove: ReturnType<typeof vi.fn>;
  pairingsDeny: ReturnType<typeof vi.fn>;
  pairingsRevoke: ReturnType<typeof vi.fn>;
  agentListGet: ReturnType<typeof vi.fn>;
  agentStatusGet: ReturnType<typeof vi.fn>;
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
  const desktopEnvironmentHostsList = vi.fn(
    async () => ({ status: "ok", hosts: [sampleDesktopEnvironmentHost()] }) as const,
  );
  const desktopEnvironmentsList = vi.fn(
    async () => ({ status: "ok", environments: [sampleDesktopEnvironment()] }) as const,
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
            risk: "low",
            requires_confirmation: false,
            effective_exposure: { enabled: true, reason: "enabled" },
          },
          {
            source: "plugin",
            canonical_id: "connector.send",
            description: "Send via a connector.",
            risk: "medium",
            requires_confirmation: true,
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
      get: vi.fn(async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const),
      create: vi.fn(
        async () => ({ status: "ok", environment: sampleDesktopEnvironment() }) as const,
      ),
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
    pairingsApprove,
    pairingsDeny,
    pairingsRevoke,
    agentListGet,
    agentStatusGet,
    modelAssignmentsUpdate,
  };
}
