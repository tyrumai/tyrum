import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface AgentStatusState {
  agentKey: string;
  status: unknown | null;
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface AgentStatusStore extends ExternalStore<AgentStatusState> {
  setAgentKey(agentKey: string): void;
  refresh(): Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAgentStatusStore(http: OperatorHttpClient): { store: AgentStatusStore } {
  const { store, setState } = createStore<AgentStatusState>({
    agentKey: "default",
    status: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  let refreshRunId = 0;
  let activeRefreshRunId: number | null = null;

  function setAgentKey(agentKey: string): void {
    const trimmed = agentKey.trim();
    setState((prev) => {
      if (prev.agentKey === trimmed) return prev;
      return {
        ...prev,
        agentKey: trimmed,
        status: null,
        error: null,
        lastSyncedAt: null,
      };
    });
  }

  async function refresh(): Promise<void> {
    const snapshot = store.getSnapshot();
    const agentKey = snapshot.agentKey.trim();

    const runId = ++refreshRunId;
    activeRefreshRunId = runId;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const status = await http.agentStatus.get(agentKey ? { agent_key: agentKey } : undefined);
      if (activeRefreshRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        status,
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
      setAgentKey,
      refresh,
    },
  };
}
