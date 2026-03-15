import { vi } from "vitest";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { sampleNodeInventoryResponse } from "../operator-ui.http-fixture-data.js";

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

  const activityStore = createMockActivityStore();
  const nodesList = vi.fn(async () => sampleNodeInventoryResponse());

  const core = {
    connectionStore,
    statusStore,
    approvalsStore,
    pairingStore,
    runsStore,
    workboardStore,
    activityStore,
    http: {
      nodes: {
        list: nodesList,
      },
    },
    ...overrides,
  } as unknown as OperatorCore;

  return { core, setConnectionState, setStatusState, nodesList };
}
