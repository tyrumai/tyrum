import { AgentConfig, createStore, IdentityPack } from "@tyrum/operator-app";
import type { StatusResponse } from "@tyrum/operator-app/browser";

export function createConnectionStore() {
  return createStore({
    status: "connected" as const,
    clientId: "layout-harness",
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  }).store;
}

export function createEventWsStub() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event: string, handler: (payload: unknown) => void) {
      const next = handlers.get(event) ?? new Set();
      next.add(handler);
      handlers.set(event, next);
    },
    off(event: string, handler: (payload: unknown) => void) {
      const next = handlers.get(event);
      if (!next) return;
      next.delete(handler);
      if (next.size === 0) {
        handlers.delete(event);
      }
    },
  };
}

export function createStatusStore() {
  const status: StatusResponse = {
    status: "ok",
    version: "1.0.0",
    instance_id: "layout-harness",
    role: "all",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    auth: { enabled: true },
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: {
      default: {
        agent_id: "default",
        active_session_ids: ["session-1"],
      },
    },
    queue_depth: {
      pending: 1,
      running: 1,
    },
    sandbox: null,
    config_health: { status: "ok", issues: [] },
  };

  return createStore({
    status,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: "2026-03-08T00:00:00.000Z",
  }).store;
}

export function createApprovalsStore() {
  const { store } = createStore({
    pendingIds: ["approval-1"],
    byId: {
      "approval-1": {
        approval_id: 1,
        approval_key: "approval:1",
        kind: "other",
        status: "pending",
        prompt: "Allow the tool call?",
        created_at: "2026-03-08T00:00:00.000Z",
        expires_at: null,
        resolution: null,
        scope: {
          conversation_key: "agent:default:main",
          turn_id: undefined,
          step_id: null,
          attempt_id: null,
        },
        context: null,
      },
    },
    loading: false,
    error: null,
    lastSyncedAt: "2026-03-08T00:00:00.000Z",
  });

  return {
    ...store,
    refreshPending: async () => {},
    resolve: async () => {},
  };
}

export function createTurnsStore() {
  return {
    ...createStore({
      turnsById: {
        "11111111-1111-4111-8111-111111111111": {
          turn_id: "11111111-1111-4111-8111-111111111111",
          job_id: "22222222-2222-4222-8222-222222222222",
          conversation_key: "agent:default:main",
          status: "running",
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:01.000Z",
          finished_at: null,
          attempt: 1,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
      agentKeyByTurnId: {
        "11111111-1111-4111-8111-111111111111": "default",
      },
      conversationKeyByTurnId: {},
    }).store,
    refreshRecent: async () => {},
  };
}

export function createWorkboardStore() {
  return {
    ...createStore({
      items: [
        {
          work_item_id: "wi-1",
          title: "Fix layout overflow",
          kind: "task",
          priority: 2,
          status: "doing",
          acceptance: { done: true },
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:05:00.000Z",
          last_active_at: "2026-03-08T00:10:00.000Z",
        },
        {
          work_item_id: "wi-2",
          title: "Add layout regression coverage",
          kind: "task",
          priority: 1,
          status: "backlog",
          acceptance: { done: false },
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:05:00.000Z",
          last_active_at: "2026-03-08T00:10:00.000Z",
        },
      ],
      tasksByWorkItemId: {},
      scopeKeys: {
        agent_key: "default",
        workspace_key: "default",
      },
      supported: true,
      loading: false,
      error: null,
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    }).store,
    refreshList: async () => {},
    setScopeKeys: () => {},
    resetSupportProbe: () => {},
    upsertWorkItem: () => {},
  };
}

export function createPairingStore() {
  const pending = {
    pairing_id: 1,
    status: "pending",
    trust_level: "local",
    requested_at: "2026-03-08T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "My node",
      last_seen_at: "2026-03-08T00:00:00.000Z",
      capabilities: ["desktop", "cli", "http"],
      metadata: {
        platform: "darwin",
        version: "14.0",
        mode: "local",
        ip: "127.0.0.1",
      },
    },
    capability_allowlist: [
      { id: "tyrum.desktop", version: "1.0.0" },
      { id: "tyrum.cli", version: "1.0.0" },
    ],
    resolution: null,
    resolved_at: null,
  };

  const approved = {
    ...pending,
    pairing_id: 2,
    status: "approved",
    resolution: {
      decision: "approved",
      resolved_at: "2026-03-08T00:01:00.000Z",
      reason: "ok",
    },
    resolved_at: "2026-03-08T00:01:00.000Z",
  };

  return {
    ...createStore({
      pendingIds: [String(pending.pairing_id)],
      approvedIds: [String(approved.pairing_id)],
      byId: {
        [String(pending.pairing_id)]: pending,
        [String(approved.pairing_id)]: approved,
      },
      loading: false,
      error: null,
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    }).store,
    refresh: async () => {},
    approve: async () => {},
    deny: async () => {},
    revoke: async () => {},
  };
}

export function createActivityStore() {
  return {
    ...createStore({
      agentsById: {},
      agentIds: [],
      workstreamsById: {},
      workstreamIds: [],
      selectedAgentId: null,
      selectedWorkstreamId: null,
    }).store,
    clearSelection: () => {},
    selectWorkstream: () => {},
  };
}

export function createAgentStatusStore() {
  const { store, setState } = createStore({
    agentKey: "default",
    status: {
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
      skills: ["review"],
      skills_detailed: [
        {
          id: "review",
          name: "Review",
          version: "1.0.0",
          source: "bundled",
        },
      ],
      workspace_skills_trusted: true,
      mcp: [],
      tools: ["shell"],
      conversations: {
        ttl_days: 365,
        max_turns: 0,
        loop_detection: {
          within_turn: {
            enabled: true,
            consecutive_repeat_limit: 3,
            cycle_repeat_limit: 3,
          },
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
    },
    loading: false,
    error: null,
    lastSyncedAt: "2026-03-08T00:00:00.000Z",
  });

  return {
    ...store,
    setAgentKey: (agentKey: string) => {
      setState((previous) => ({ ...previous, agentKey }));
    },
    refresh: async () => {},
  };
}

export function createManagedAgentDetail(agentKey: string) {
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
      description: "Managed agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        description: "Managed agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "default" ? "Default Agent" : "Agent One",
        description: "Managed agent",
        style: {
          tone: "direct",
        },
      },
      body: "",
    }),
    config_revision: 1,
    identity_revision: 1,
    config_sha256: "a".repeat(64),
    identity_sha256: "b".repeat(64),
  };
}
