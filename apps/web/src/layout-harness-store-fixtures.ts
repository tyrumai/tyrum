import type { StatusResponse } from "@tyrum/client";
import { createStore } from "../../../packages/operator-core/src/store.js";
import {
  createLayoutHarnessActiveSession,
  createLayoutHarnessAgentStatus,
  createLayoutHarnessApprovedPairing,
  createLayoutHarnessMemoryItem,
  createLayoutHarnessPendingPairing,
  createManagedAgentDetailFixture,
} from "./layout-harness-store-fixture-builders.js";

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
        approval_id: "00000000-0000-4000-8000-000000000001",
        approval_key: "approval:1",
        kind: "workflow_step",
        status: "awaiting_human",
        prompt: "Allow the tool call?",
        motivation: "The workflow needs operator confirmation before running this tool.",
        created_at: "2026-03-08T00:00:00.000Z",
        expires_at: null,
        latest_review: {
          review_id: "00000000-0000-4000-8000-000000000011",
          target_type: "approval",
          target_id: "00000000-0000-4000-8000-000000000001",
          reviewer_kind: "system",
          reviewer_id: null,
          state: "requested_human",
          reason: "Awaiting human review.",
          risk_level: null,
          risk_score: null,
          evidence: null,
          decision_payload: null,
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: null,
          completed_at: "2026-03-08T00:00:00.000Z",
        },
        scope: {
          key: "agent:default:main",
          lane: "main",
          run_id: null,
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

export function createRunsStore() {
  return {
    ...createStore({
      runsById: {
        "run-1": {
          run_id: "run-1",
          key: "agent:default:main",
          lane: "main",
          status: "running",
          created_at: "2026-03-08T00:00:00.000Z",
          started_at: "2026-03-08T00:00:01.000Z",
          finished_at: null,
          attempt: 1,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: {
        "run-1": "default",
      },
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
      supported: true,
      loading: false,
      error: null,
      lastSyncedAt: "2026-03-08T00:00:00.000Z",
    }).store,
    refreshList: async () => {},
    resetSupportProbe: () => {},
    upsertWorkItem: () => {},
  };
}

export function createChatStore() {
  const activeSession = createLayoutHarnessActiveSession();

  const { store, setState } = createStore({
    agentId: "default",
    agents: {
      agents: [{ agent_id: "default" }, { agent_id: "agent-1" }],
      loading: false,
      error: null,
    },
    sessions: {
      sessions: [
        {
          agent_id: "default",
          session_id: "session-1",
          channel: "ui",
          thread_id: "ui-thread-1",
          title: "Layout regression coverage",
          summary: "Layout regression coverage thread",
          transcript_count: 2,
          last_text: {
            role: "assistant",
            content: "Yes. We can add browser geometry checks.",
          },
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
        },
      ],
      nextCursor: null,
      loading: false,
      error: null,
    },
    active: {
      sessionId: "session-1",
      session: activeSession,
      loading: false,
      typing: false,
      activeToolCallIds: [],
      error: null,
    },
    send: {
      sending: false,
      error: null,
    },
  });

  return {
    ...store,
    setAgentId(agentId: string) {
      setState((previous) => ({ ...previous, agentId }));
    },
    refreshAgents: async () => {},
    refreshSessions: async () => {},
    loadMoreSessions: async () => {},
    openSession: async (sessionId: string) => {
      setState((previous) => ({
        ...previous,
        active: {
          ...previous.active,
          sessionId,
          session: activeSession,
        },
      }));
    },
    newChat: async () => {},
    sendMessage: async () => {},
    compactActive: async () => {},
    deleteActive: async () => {},
  };
}

export function createPairingStore() {
  const pending = createLayoutHarnessPendingPairing();
  const approved = createLayoutHarnessApprovedPairing();

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
    status: createLayoutHarnessAgentStatus(),
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

export function createMemoryStore() {
  const item = createLayoutHarnessMemoryItem();

  return {
    ...createStore({
      browse: {
        request: null,
        results: {
          kind: "list",
          items: [item],
          nextCursor: null,
        },
        loading: false,
        error: null,
        lastSyncedAt: "2026-03-08T00:00:00.000Z",
      },
      inspect: {
        agentId: "default",
        memoryItemId: "memory-1",
        item,
        loading: false,
        error: null,
      },
      tombstones: {
        tombstones: [],
        loading: false,
        error: null,
      },
      export: {
        running: false,
        artifactId: "artifact-1",
        error: null,
        lastExportedAt: "2026-03-08T00:00:00.000Z",
      },
    }).store,
    list: async () => {},
    search: async () => {},
    refreshBrowse: async () => {},
    loadMore: async () => {},
    inspect: async () => {},
    update: async () => {},
    forget: async () => {},
    export: async () => {},
  };
}
export function createManagedAgentDetail(agentKey: string) {
  return createManagedAgentDetailFixture(agentKey);
}
