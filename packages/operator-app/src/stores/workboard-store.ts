import type { WorkItem } from "@tyrum/contracts";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";
import { toErrorMessage } from "../to-error-message.js";
import {
  applyWorkTaskEvent,
  upsertWorkItem,
  type WorkTaskEvent,
  type WorkTasksByWorkItemId,
} from "../workboard/workboard-utils.js";

export interface WorkboardState {
  items: WorkItem[];
  tasksByWorkItemId: WorkTasksByWorkItemId;
  scopeKeys: WorkboardScopeKeys;
  supported: boolean | null;
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface WorkboardStore extends ExternalStore<WorkboardState> {
  refreshList(): Promise<void>;
  setScopeKeys(scopeKeys: Partial<WorkboardScopeKeys>): void;
  upsertWorkItem(item: WorkItem): void;
  resetSupportProbe(): void;
}

export interface WorkboardScopeKeys {
  agent_key: string;
  workspace_key: string;
}

const DEFAULT_SCOPE_KEYS: WorkboardScopeKeys = {
  agent_key: "default",
  workspace_key: "default",
} as const;

function normalizeScopeKeys(scopeKeys?: Partial<WorkboardScopeKeys>): WorkboardScopeKeys {
  const agentKey = scopeKeys?.agent_key?.trim() || DEFAULT_SCOPE_KEYS.agent_key;
  const workspaceKey = scopeKeys?.workspace_key?.trim() || DEFAULT_SCOPE_KEYS.workspace_key;
  return {
    agent_key: agentKey,
    workspace_key: workspaceKey,
  };
}

function isUnsupportedRequestForWorkList(errorMessage: string): boolean {
  return errorMessage.includes("work.list failed: unsupported_request");
}

export function createWorkboardStore(ws: OperatorWsClient): {
  store: WorkboardStore;
  handleWorkItemUpsert: (item: WorkItem) => void;
  handleWorkTaskEvent: (event: WorkTaskEvent) => void;
} {
  const { store, setState } = createStore<WorkboardState>({
    items: [],
    tasksByWorkItemId: {},
    scopeKeys: DEFAULT_SCOPE_KEYS,
    supported: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  let refreshRunId = 0;
  let activeRefreshRunId: number | null = null;
  let bufferedWorkItemUpserts = new Map<string, WorkItem>();

  function resetSupportProbe(): void {
    setState((prev) => {
      if (prev.supported !== false) return prev;
      return { ...prev, supported: null, error: null };
    });
  }

  function setScopeKeys(scopeKeys: Partial<WorkboardScopeKeys>): void {
    const nextScopeKeys = normalizeScopeKeys(scopeKeys);
    refreshRunId += 1;
    activeRefreshRunId = null;
    bufferedWorkItemUpserts = new Map<string, WorkItem>();

    setState((prev) => {
      if (
        prev.scopeKeys.agent_key === nextScopeKeys.agent_key &&
        prev.scopeKeys.workspace_key === nextScopeKeys.workspace_key
      ) {
        return prev;
      }
      return {
        ...prev,
        items: [],
        tasksByWorkItemId: {},
        scopeKeys: nextScopeKeys,
        loading: false,
        error: null,
        lastSyncedAt: null,
      };
    });
  }

  function handleWorkItemUpsert(item: WorkItem): void {
    if (activeRefreshRunId !== null) {
      bufferedWorkItemUpserts.set(item.work_item_id, item);
    }
    setState((prev) => ({
      ...prev,
      supported: prev.supported ?? true,
      items: upsertWorkItem(prev.items, item),
    }));
  }

  function handleWorkTaskEvent(event: WorkTaskEvent): void {
    setState((prev) => ({
      ...prev,
      supported: prev.supported ?? true,
      tasksByWorkItemId: applyWorkTaskEvent(prev.tasksByWorkItemId, event),
    }));
  }

  async function refreshList(): Promise<void> {
    const runId = ++refreshRunId;
    activeRefreshRunId = runId;
    bufferedWorkItemUpserts = new Map<string, WorkItem>();

    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const scopeKeys = store.getSnapshot().scopeKeys;
      const result = await ws.workList({ ...scopeKeys, limit: 200 });
      if (activeRefreshRunId !== runId) return;
      const buffered = bufferedWorkItemUpserts;

      setState((prev) => {
        let items = result.items;
        for (const item of buffered.values()) {
          items = upsertWorkItem(items, item);
        }

        return {
          ...prev,
          items,
          supported: true,
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (activeRefreshRunId !== runId) return;
      const message = toErrorMessage(error);
      if (isUnsupportedRequestForWorkList(message)) {
        setState((prev) => ({
          ...prev,
          items: [],
          supported: false,
          loading: false,
          error: "WorkBoard is not supported by this gateway (database not configured).",
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    } finally {
      if (activeRefreshRunId === runId) {
        activeRefreshRunId = null;
        bufferedWorkItemUpserts = new Map<string, WorkItem>();
      }
    }
  }

  return {
    store: {
      ...store,
      refreshList,
      setScopeKeys,
      upsertWorkItem: handleWorkItemUpsert,
      resetSupportProbe,
    },
    handleWorkItemUpsert,
    handleWorkTaskEvent,
  };
}
