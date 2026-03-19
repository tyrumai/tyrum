import type {
  DesktopEnvironmentCreateInput,
  DesktopEnvironmentGetResult,
  DesktopEnvironmentUpdateInput,
} from "@tyrum/transport-sdk";
import type { OperatorHttpClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";
import { toErrorMessage } from "../to-error-message.js";

type DesktopEnvironment = DesktopEnvironmentGetResult["environment"];

export interface DesktopEnvironmentLogState {
  lines: string[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface DesktopEnvironmentsState {
  byId: Record<string, DesktopEnvironment>;
  orderedIds: string[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  logsById: Record<string, DesktopEnvironmentLogState | undefined>;
}

export interface DesktopEnvironmentsStore extends ExternalStore<DesktopEnvironmentsState> {
  refresh(): Promise<void>;
  create(input: DesktopEnvironmentCreateInput): Promise<DesktopEnvironment>;
  update(environmentId: string, input: DesktopEnvironmentUpdateInput): Promise<DesktopEnvironment>;
  start(environmentId: string): Promise<DesktopEnvironment>;
  stop(environmentId: string): Promise<DesktopEnvironment>;
  reset(environmentId: string): Promise<DesktopEnvironment>;
  remove(environmentId: string): Promise<boolean>;
  refreshLogs(environmentId: string): Promise<string[]>;
}

type SetState<T> = (updater: (prev: T) => T) => void;

function replaceEnvironments(
  state: DesktopEnvironmentsState,
  environments: readonly DesktopEnvironment[],
): DesktopEnvironmentsState {
  const byId: Record<string, DesktopEnvironment> = {};
  const orderedIds: string[] = [];
  const logsById: DesktopEnvironmentsState["logsById"] = {};

  for (const environment of environments) {
    byId[environment.environment_id] = environment;
    orderedIds.push(environment.environment_id);
    logsById[environment.environment_id] = state.logsById[environment.environment_id];
  }

  return {
    ...state,
    byId,
    orderedIds,
    logsById,
  };
}

function upsertEnvironment(
  state: DesktopEnvironmentsState,
  environment: DesktopEnvironment,
): DesktopEnvironmentsState {
  const orderedIds = state.orderedIds.includes(environment.environment_id)
    ? state.orderedIds
    : [...state.orderedIds, environment.environment_id];
  return {
    ...state,
    byId: {
      ...state.byId,
      [environment.environment_id]: environment,
    },
    orderedIds,
  };
}

function removeEnvironment(
  state: DesktopEnvironmentsState,
  environmentId: string,
): DesktopEnvironmentsState {
  const byId = { ...state.byId };
  const logsById = { ...state.logsById };
  delete byId[environmentId];
  delete logsById[environmentId];
  return {
    ...state,
    byId,
    logsById,
    orderedIds: state.orderedIds.filter((entry) => entry !== environmentId),
  };
}

function upsertLogs(
  state: DesktopEnvironmentsState,
  environmentId: string,
  next: Partial<DesktopEnvironmentLogState>,
): DesktopEnvironmentsState {
  const current = state.logsById[environmentId] ?? {
    lines: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  };
  return {
    ...state,
    logsById: {
      ...state.logsById,
      [environmentId]: {
        ...current,
        ...next,
      },
    },
  };
}

async function mutateEnvironment(
  action: () => Promise<DesktopEnvironment>,
  setState: SetState<DesktopEnvironmentsState>,
): Promise<DesktopEnvironment> {
  const environment = await action();
  setState((prev) => upsertEnvironment(prev, environment));
  return environment;
}

export function createDesktopEnvironmentsStore(http: OperatorHttpClient): {
  store: DesktopEnvironmentsStore;
} {
  const { store, setState } = createStore<DesktopEnvironmentsState>({
    byId: {},
    orderedIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
    logsById: {},
  });

  let refreshRunId = 0;
  let activeRefreshRunId: number | null = null;
  const logRefreshRunIds = new Map<string, number>();

  async function refresh(): Promise<void> {
    const runId = ++refreshRunId;
    activeRefreshRunId = runId;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await http.desktopEnvironments.list();
      if (activeRefreshRunId !== runId) return;
      setState((prev) => ({
        ...replaceEnvironments(prev, result.environments),
        loading: false,
        error: null,
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

  async function refreshLogs(environmentId: string): Promise<string[]> {
    const runId = (logRefreshRunIds.get(environmentId) ?? 0) + 1;
    logRefreshRunIds.set(environmentId, runId);
    setState((prev) => upsertLogs(prev, environmentId, { loading: true, error: null }));

    try {
      const result = await http.desktopEnvironments.logs(environmentId);
      if (logRefreshRunIds.get(environmentId) !== runId) {
        return result.logs;
      }
      setState((prev) =>
        upsertLogs(prev, environmentId, {
          lines: result.logs,
          loading: false,
          error: null,
          lastSyncedAt: new Date().toISOString(),
        }),
      );
      return result.logs;
    } catch (error) {
      if (logRefreshRunIds.get(environmentId) !== runId) {
        return [];
      }
      setState((prev) =>
        upsertLogs(prev, environmentId, {
          loading: false,
          error: toErrorMessage(error),
        }),
      );
      throw error;
    }
  }

  return {
    store: {
      ...store,
      refresh,
      create: (input) =>
        mutateEnvironment(
          async () => (await http.desktopEnvironments.create(input)).environment,
          setState,
        ),
      update: (environmentId, input) =>
        mutateEnvironment(
          async () => (await http.desktopEnvironments.update(environmentId, input)).environment,
          setState,
        ),
      start: (environmentId) =>
        mutateEnvironment(
          async () => (await http.desktopEnvironments.start(environmentId)).environment,
          setState,
        ),
      stop: (environmentId) =>
        mutateEnvironment(
          async () => (await http.desktopEnvironments.stop(environmentId)).environment,
          setState,
        ),
      reset: (environmentId) =>
        mutateEnvironment(
          async () => (await http.desktopEnvironments.reset(environmentId)).environment,
          setState,
        ),
      remove: async (environmentId) => {
        const result = await http.desktopEnvironments.remove(environmentId);
        setState((prev) => removeEnvironment(prev, environmentId));
        return result.deleted;
      },
      refreshLogs,
    },
  };
}
