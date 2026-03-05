import type { PresenceResponse, StatusResponse, UsageResponse } from "@tyrum/client";
import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";
import { toErrorMessage } from "../to-error-message.js";

export type OperatorPresenceEntry = PresenceResponse["entries"][number];

export interface StatusState {
  status: StatusResponse | null;
  usage: UsageResponse | null;
  presenceByInstanceId: Record<string, OperatorPresenceEntry>;
  loading: {
    status: boolean;
    usage: boolean;
    presence: boolean;
  };
  error: {
    status: string | null;
    usage: string | null;
    presence: string | null;
  };
  lastSyncedAt: string | null;
}

export interface StatusStore extends ExternalStore<StatusState> {
  refreshStatus(): Promise<void>;
  refreshUsage(query?: Parameters<OperatorHttpClient["usage"]["get"]>[0]): Promise<void>;
  refreshPresence(): Promise<void>;
}

type SetState<T> = (updater: (prev: T) => T) => void;

interface RefreshRunState {
  runId: number;
  activeRunId: number | null;
}

function beginRefresh(runState: RefreshRunState): number {
  const runId = ++runState.runId;
  runState.activeRunId = runId;
  return runId;
}

function isRefreshActive(runState: RefreshRunState, runId: number): boolean {
  return runState.activeRunId === runId;
}

function endRefreshIfActive(runState: RefreshRunState, runId: number): void {
  if (runState.activeRunId === runId) {
    runState.activeRunId = null;
  }
}

async function refreshStatusImpl(
  http: OperatorHttpClient,
  setState: SetState<StatusState>,
  runState: RefreshRunState,
): Promise<void> {
  const runId = beginRefresh(runState);
  setState((prev) => ({
    ...prev,
    loading: { ...prev.loading, status: true },
    error: { ...prev.error, status: null },
  }));
  try {
    const status = await http.status.get();
    if (!isRefreshActive(runState, runId)) return;
    setState((prev) => ({
      ...prev,
      status,
      loading: { ...prev.loading, status: false },
      lastSyncedAt: new Date().toISOString(),
    }));
  } catch (error) {
    if (!isRefreshActive(runState, runId)) return;
    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, status: false },
      error: { ...prev.error, status: toErrorMessage(error) },
    }));
  } finally {
    endRefreshIfActive(runState, runId);
  }
}

async function refreshUsageImpl(
  http: OperatorHttpClient,
  setState: SetState<StatusState>,
  runState: RefreshRunState,
  query?: Parameters<OperatorHttpClient["usage"]["get"]>[0],
): Promise<void> {
  const runId = beginRefresh(runState);
  setState((prev) => ({
    ...prev,
    loading: { ...prev.loading, usage: true },
    error: { ...prev.error, usage: null },
  }));
  try {
    const usage = await http.usage.get(query);
    if (!isRefreshActive(runState, runId)) return;
    setState((prev) => ({
      ...prev,
      usage,
      loading: { ...prev.loading, usage: false },
      lastSyncedAt: new Date().toISOString(),
    }));
  } catch (error) {
    if (!isRefreshActive(runState, runId)) return;
    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, usage: false },
      error: { ...prev.error, usage: toErrorMessage(error) },
    }));
  } finally {
    endRefreshIfActive(runState, runId);
  }
}

interface PresenceRefreshState extends RefreshRunState {
  bufferedUpserts: Map<string, OperatorPresenceEntry>;
  bufferedPrunes: Set<string>;
}

function resetPresenceBuffers(state: PresenceRefreshState): void {
  state.bufferedUpserts = new Map<string, OperatorPresenceEntry>();
  state.bufferedPrunes = new Set<string>();
}

async function refreshPresenceImpl(
  http: OperatorHttpClient,
  setState: SetState<StatusState>,
  state: PresenceRefreshState,
): Promise<void> {
  const runId = beginRefresh(state);
  resetPresenceBuffers(state);

  setState((prev) => ({
    ...prev,
    loading: { ...prev.loading, presence: true },
    error: { ...prev.error, presence: null },
  }));
  try {
    const presence = await http.presence.list();
    if (!isRefreshActive(state, runId)) return;
    const upserts = state.bufferedUpserts;
    const prunes = state.bufferedPrunes;

    const presenceByInstanceId: Record<string, OperatorPresenceEntry> = {};
    for (const entry of presence.entries) {
      presenceByInstanceId[entry.instance_id] = entry;
    }
    for (const entry of upserts.values()) {
      presenceByInstanceId[entry.instance_id] = {
        ...presenceByInstanceId[entry.instance_id],
        ...entry,
      };
    }
    for (const instanceId of prunes) {
      delete presenceByInstanceId[instanceId];
    }
    setState((prev) => ({
      ...prev,
      presenceByInstanceId,
      loading: { ...prev.loading, presence: false },
      lastSyncedAt: new Date().toISOString(),
    }));
  } catch (error) {
    if (!isRefreshActive(state, runId)) return;
    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, presence: false },
      error: { ...prev.error, presence: toErrorMessage(error) },
    }));
  } finally {
    if (state.activeRunId === runId) {
      state.activeRunId = null;
      resetPresenceBuffers(state);
    }
  }
}

function handlePresenceUpsertImpl(
  setState: SetState<StatusState>,
  refreshState: PresenceRefreshState,
  entry: OperatorPresenceEntry,
): void {
  if (refreshState.activeRunId !== null) {
    refreshState.bufferedPrunes.delete(entry.instance_id);
    refreshState.bufferedUpserts.set(entry.instance_id, entry);
  }
  setState((prev) => ({
    ...prev,
    presenceByInstanceId: {
      ...prev.presenceByInstanceId,
      [entry.instance_id]: {
        ...prev.presenceByInstanceId[entry.instance_id],
        ...entry,
      },
    },
  }));
}

function handlePresencePrunedImpl(
  setState: SetState<StatusState>,
  refreshState: PresenceRefreshState,
  instanceId: string,
): void {
  if (refreshState.activeRunId !== null) {
    refreshState.bufferedUpserts.delete(instanceId);
    refreshState.bufferedPrunes.add(instanceId);
  }
  setState((prev) => {
    if (!(instanceId in prev.presenceByInstanceId)) return prev;
    const next = { ...prev.presenceByInstanceId };
    delete next[instanceId];
    return { ...prev, presenceByInstanceId: next };
  });
}

export function createStatusStore(http: OperatorHttpClient): {
  store: StatusStore;
  handlePresenceUpsert: (entry: OperatorPresenceEntry) => void;
  handlePresencePruned: (instanceId: string) => void;
} {
  const { store, setState } = createStore<StatusState>({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });

  const refreshStatusState: RefreshRunState = { runId: 0, activeRunId: null };
  const refreshUsageState: RefreshRunState = { runId: 0, activeRunId: null };
  const refreshPresenceState: PresenceRefreshState = {
    runId: 0,
    activeRunId: null,
    bufferedUpserts: new Map<string, OperatorPresenceEntry>(),
    bufferedPrunes: new Set<string>(),
  };

  return {
    store: {
      ...store,
      refreshStatus: () => refreshStatusImpl(http, setState, refreshStatusState),
      refreshUsage: (query) => refreshUsageImpl(http, setState, refreshUsageState, query),
      refreshPresence: () => refreshPresenceImpl(http, setState, refreshPresenceState),
    },
    handlePresenceUpsert: (entry) =>
      handlePresenceUpsertImpl(setState, refreshPresenceState, entry),
    handlePresencePruned: (instanceId) =>
      handlePresencePrunedImpl(setState, refreshPresenceState, instanceId),
  };
}
