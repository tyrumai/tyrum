import type { DesktopEnvironmentHostListResult } from "@tyrum/client/browser";
import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";
import { toErrorMessage } from "../to-error-message.js";

type DesktopEnvironmentHost = DesktopEnvironmentHostListResult["hosts"][number];

export interface DesktopEnvironmentHostsState {
  byId: Record<string, DesktopEnvironmentHost>;
  orderedIds: string[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface DesktopEnvironmentHostsStore extends ExternalStore<DesktopEnvironmentHostsState> {
  refresh(): Promise<void>;
}

function replaceHosts(
  hosts: readonly DesktopEnvironmentHost[],
): Pick<DesktopEnvironmentHostsState, "byId" | "orderedIds"> {
  const byId: Record<string, DesktopEnvironmentHost> = {};
  const orderedIds: string[] = [];
  for (const host of hosts) {
    byId[host.host_id] = host;
    orderedIds.push(host.host_id);
  }
  return { byId, orderedIds };
}

export function createDesktopEnvironmentHostsStore(http: OperatorHttpClient): {
  store: DesktopEnvironmentHostsStore;
} {
  const { store, setState } = createStore<DesktopEnvironmentHostsState>({
    byId: {},
    orderedIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  let refreshRunId = 0;
  let activeRefreshRunId: number | null = null;

  async function refresh(): Promise<void> {
    const runId = ++refreshRunId;
    activeRefreshRunId = runId;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await http.desktopEnvironmentHosts.list();
      if (activeRefreshRunId !== runId) return;
      const next = replaceHosts(result.hosts);
      setState((prev) => ({
        ...prev,
        ...next,
        loading: false,
        lastSyncedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (activeRefreshRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: toErrorMessage(error),
      }));
    } finally {
      if (activeRefreshRunId === runId) {
        activeRefreshRunId = null;
      }
    }
  }

  return {
    store: {
      ...store,
      refresh,
    },
  };
}
