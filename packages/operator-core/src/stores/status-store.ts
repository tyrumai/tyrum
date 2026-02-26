import type { PresenceResponse, StatusResponse, UsageResponse } from "@tyrum/client";
import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

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
  refreshUsage(query?: unknown): Promise<void>;
  refreshPresence(): Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  let refreshPresenceRunId = 0;
  let activeRefreshPresenceRunId: number | null = null;
  let bufferedPresenceUpserts = new Map<string, OperatorPresenceEntry>();
  let bufferedPresencePrunes = new Set<string>();

  async function refreshStatus(): Promise<void> {
    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, status: true },
      error: { ...prev.error, status: null },
    }));
    try {
      const status = await http.status.get();
      setState((prev) => ({
        ...prev,
        status,
        loading: { ...prev.loading, status: false },
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, status: false },
        error: { ...prev.error, status: toErrorMessage(error) },
      }));
    }
  }

  async function refreshUsage(query?: unknown): Promise<void> {
    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, usage: true },
      error: { ...prev.error, usage: null },
    }));
    try {
      const usage = await http.usage.get(query);
      setState((prev) => ({
        ...prev,
        usage,
        loading: { ...prev.loading, usage: false },
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, usage: false },
        error: { ...prev.error, usage: toErrorMessage(error) },
      }));
    }
  }

  async function refreshPresence(): Promise<void> {
    const runId = ++refreshPresenceRunId;
    activeRefreshPresenceRunId = runId;
    bufferedPresenceUpserts = new Map<string, OperatorPresenceEntry>();
    bufferedPresencePrunes = new Set<string>();

    setState((prev) => ({
      ...prev,
      loading: { ...prev.loading, presence: true },
      error: { ...prev.error, presence: null },
    }));
    try {
      const presence = await http.presence.list();
      if (activeRefreshPresenceRunId !== runId) return;
      const upserts = bufferedPresenceUpserts;
      const prunes = bufferedPresencePrunes;

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
      if (activeRefreshPresenceRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, presence: false },
        error: { ...prev.error, presence: toErrorMessage(error) },
      }));
    } finally {
      if (activeRefreshPresenceRunId === runId) {
        activeRefreshPresenceRunId = null;
        bufferedPresenceUpserts = new Map<string, OperatorPresenceEntry>();
        bufferedPresencePrunes = new Set<string>();
      }
    }
  }

  function handlePresenceUpsert(entry: OperatorPresenceEntry): void {
    if (activeRefreshPresenceRunId !== null) {
      bufferedPresencePrunes.delete(entry.instance_id);
      bufferedPresenceUpserts.set(entry.instance_id, entry);
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

  function handlePresencePruned(instanceId: string): void {
    if (activeRefreshPresenceRunId !== null) {
      bufferedPresenceUpserts.delete(instanceId);
      bufferedPresencePrunes.add(instanceId);
    }
    setState((prev) => {
      if (!(instanceId in prev.presenceByInstanceId)) return prev;
      const next = { ...prev.presenceByInstanceId };
      delete next[instanceId];
      return { ...prev, presenceByInstanceId: next };
    });
  }

  return {
    store: {
      ...store,
      refreshStatus,
      refreshUsage,
      refreshPresence,
    },
    handlePresenceUpsert,
    handlePresencePruned,
  };
}
