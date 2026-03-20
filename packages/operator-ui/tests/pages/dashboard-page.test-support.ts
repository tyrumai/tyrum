import { vi } from "vitest";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import type { ActivityState } from "../../../operator-app/src/stores/activity-store.js";

const emptyActivityState: ActivityState = {
  agentsById: {},
  agentIds: [],
  workstreamsById: {},
  workstreamIds: [],
  selectedAgentId: null,
  selectedWorkstreamId: null,
};

function createMockActivityStore() {
  const { store } = createStore<ActivityState>(emptyActivityState);
  return {
    ...store,
    clearSelection: vi.fn(),
    selectWorkstream: vi.fn(),
  };
}

export function sampleDashboardNodeInventoryResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        node_id: "node-1",
        label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
        connected: false,
        paired_status: "approved",
        attached_to_requested_lane: false,
        capabilities: [],
      },
    ],
  } as const;
}

export function createMockCore(overrides?: Partial<Record<string, unknown>>) {
  const { store: connectionStore, setState: setConnectionState } = createStore({
    status: "disconnected" as string,
    clientId: null,
    recovering: false,
    lastDisconnect: null,
    transportError: null,
  });

  const { store: statusStore, setState: setStatusState } = createStore({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });

  const { store: approvalsStore } = createStore({
    byId: {},
    pendingIds: [] as string[],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  const { store: pairingStore } = createStore({
    byId: {},
    pendingIds: [] as string[],
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

  const { store: workboardStore } = createStore({
    items: [] as unknown[],
    supported: null as boolean | null,
    tasksByWorkItemId: {},
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: transcriptStore } = createStore({
    agentId: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    sessions: [] as unknown[],
    nextCursor: null as string | null,
    selectedSessionKey: null as string | null,
    detail: null,
    loadingList: false,
    loadingDetail: false,
    errorList: null,
    errorDetail: null,
  });

  const activityStore = createMockActivityStore();
  const nodesList = vi.fn(async () => sampleDashboardNodeInventoryResponse());

  const core = {
    connectionStore,
    statusStore,
    approvalsStore,
    pairingStore,
    transcriptStore: {
      ...transcriptStore,
      setAgentId: vi.fn(),
      setChannel: vi.fn(),
      setActiveOnly: vi.fn(),
      setArchived: vi.fn(),
      refresh: vi.fn(),
      loadMore: vi.fn(),
      openSession: vi.fn(),
      clearDetail: vi.fn(),
    },
    runsStore,
    workboardStore,
    activityStore,
    http: {
      nodes: {
        list: nodesList,
      },
    },
    ...overrides,
  } as unknown as OperatorCore & {
    http?: OperatorCore["admin"];
    admin?: OperatorCore["admin"];
  };
  if (core.http) {
    core.admin = core.http;
  }

  return { core, setConnectionState, setStatusState, nodesList };
}
