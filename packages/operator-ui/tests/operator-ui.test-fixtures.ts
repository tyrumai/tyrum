import { vi } from "vitest";
import type { OperatorWsClient, OperatorHttpClient } from "../../operator-core/src/deps.js";
import {
  type Handler,
  type SampleExecutionStepStatus,
  type SampleExecutionAttemptStatus,
  EXECUTION_PROFILE_IDS,
} from "./operator-ui.test-support.js";
import {
  createAuthTokenHttpFixtures,
  createDeviceTokenHttpFixtures,
} from "./operator-ui.token-http-fixtures.js";
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

export function sampleStatusResponse() {
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

export function sampleUsageResponse() {
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

export function sampleAgentStatusResponse() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
      description: "Primary operator agent",
    },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
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
      ttl_days: 365,
      max_turns: 0,
      context_pruning: {
        max_messages: 0,
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

export function samplePresenceResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  } as const;
}

export function samplePairingRequestPending() {
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

export function samplePairingRequestPendingWithNodeCapabilities() {
  return {
    ...samplePairingRequestPending(),
    node: {
      ...samplePairingRequestPending().node,
      capabilities: ["cli", "http"],
    },
    capability_allowlist: [],
  } as const;
}

export function samplePairingRequestApproved() {
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

export function sampleApprovalPending() {
  return {
    approval_id: 1,
    approval_key: "approval:1",
    kind: "other",
    status: "pending",
    prompt: "Allow the tool call?",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    resolution: null,
  } as const;
}

export function sampleApprovalApproved() {
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

export function sampleExecutionRun() {
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

export type {
  SampleExecutionStepStatus,
  SampleExecutionAttemptStatus,
} from "./operator-ui.test-support.js";

export function sampleExecutionStep({
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

export function sampleExecutionAttempt({
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

export function createFakeHttpClient(): {
  http: OperatorHttpClient;
  authTokensList: ReturnType<typeof vi.fn>;
  authTokensIssue: ReturnType<typeof vi.fn>;
  authTokensRevoke: ReturnType<typeof vi.fn>;
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
  const { authTokensList, authTokensIssue, authTokensRevoke } = createAuthTokenHttpFixtures();
  const { deviceTokensIssue, deviceTokensRevoke } = createDeviceTokenHttpFixtures();
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
  const http: OperatorHttpClient = {
    authTokens: {
      list: authTokensList,
      issue: authTokensIssue,
      revoke: authTokensRevoke,
    },
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
    authTokensList,
    authTokensIssue,
    authTokensRevoke,
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
