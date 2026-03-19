import type { ExternalStore } from "./store.js";
import { createStore } from "./store.js";
import { toErrorMessage } from "./to-error-message.js";

export type AutoSyncTask = {
  id: string;
  run: () => Promise<void>;
  enabled?: () => boolean;
};

export type AutoSyncTaskState = {
  inFlight: boolean;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastError: string | null;
  nextAttemptAtMs: number | null;
};

export type AutoSyncState = {
  intervalMs: number;
  tasks: Record<string, AutoSyncTaskState>;
  lastRunAtMs: number | null;
  lastManualAtMs: number | null;
  isSyncing: boolean;
};

export type AutoSyncManager = {
  store: ExternalStore<AutoSyncState>;
  handleConnected: () => Promise<void>;
  tick: () => Promise<void>;
  syncAllNow: () => Promise<void>;
  dispose: () => void;
};

export function createAutoSyncManager(params: {
  intervalMs: number;
  tasks: AutoSyncTask[];
  isConnected: () => boolean;
  nowMs: () => number;
  random: () => number;
  backoffCapMs?: number;
  jitterPct?: number;
  start?: boolean;
}): AutoSyncManager {
  const {
    intervalMs,
    tasks,
    isConnected,
    nowMs,
    random,
    backoffCapMs = 300_000,
    jitterPct = 0.1,
    start = true,
  } = params;

  const taskById = new Map<string, AutoSyncTask>();
  for (const task of tasks) {
    if (taskById.has(task.id)) {
      throw new Error(`Duplicate auto-sync task id: ${task.id}`);
    }
    taskById.set(task.id, task);
  }

  const initialTasksState: Record<string, AutoSyncTaskState> = {};
  for (const task of tasks) {
    initialTasksState[task.id] = {
      inFlight: false,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastError: null,
      nextAttemptAtMs: null,
    };
  }

  const { store, setState } = createStore<AutoSyncState>({
    intervalMs,
    tasks: initialTasksState,
    lastRunAtMs: null,
    lastManualAtMs: null,
    isSyncing: false,
  });

  const inFlightPromises = new Map<string, Promise<void>>();

  const computeJitteredDelayMs = (baseDelayMs: number) => {
    if (jitterPct <= 0) return baseDelayMs;
    const r = random();
    const signed = r * 2 - 1; // [-1, 1]
    const jitter = baseDelayMs * jitterPct * signed;
    return Math.max(0, Math.round(baseDelayMs + jitter));
  };

  const computeBackoffDelayMs = (failureCount: number) => {
    const base = intervalMs * 2 ** Math.max(0, failureCount - 1);
    const capped = Math.min(backoffCapMs, base);
    return computeJitteredDelayMs(capped);
  };

  const computeSuccessDelayMs = () => computeJitteredDelayMs(intervalMs);

  const updateIsSyncing = () => {
    setState((prev) => {
      const isSyncing = Object.values(prev.tasks).some((t) => t.inFlight);
      if (isSyncing === prev.isSyncing) return prev;
      return { ...prev, isSyncing };
    });
  };

  const runTask = async (taskId: string) => {
    const existing = inFlightPromises.get(taskId);
    if (existing) return existing;

    const task = taskById.get(taskId);
    if (!task) return;

    const enabled = task.enabled?.() ?? true;
    if (!enabled) {
      const now = nowMs();
      setState((prev) => {
        const prevTask = prev.tasks[taskId];
        if (!prevTask) return prev;
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: {
              ...prevTask,
              lastError: null,
              nextAttemptAtMs: now + computeSuccessDelayMs(),
            },
          },
        };
      });
      return;
    }

    setState((prev) => {
      const prevTask = prev.tasks[taskId];
      if (!prevTask) return prev;
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...prevTask,
            inFlight: true,
          },
        },
      };
    });
    updateIsSyncing();

    const promise = (async () => {
      try {
        await task.run();
        const successAtMs = nowMs();
        const nextDelayMs = computeSuccessDelayMs();
        setState((prev) => {
          const prevTask = prev.tasks[taskId];
          if (!prevTask) return prev;
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [taskId]: {
                ...prevTask,
                inFlight: false,
                consecutiveFailures: 0,
                lastSuccessAt: successAtMs,
                lastError: null,
                nextAttemptAtMs: successAtMs + nextDelayMs,
              },
            },
          };
        });
      } catch (error) {
        const failureAtMs = nowMs();
        setState((prev) => {
          const prevTask = prev.tasks[taskId];
          if (!prevTask) return prev;
          const consecutiveFailures = prevTask.consecutiveFailures + 1;
          const nextDelayMs = computeBackoffDelayMs(consecutiveFailures);
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [taskId]: {
                ...prevTask,
                inFlight: false,
                consecutiveFailures,
                lastError: toErrorMessage(error),
                nextAttemptAtMs: failureAtMs + nextDelayMs,
              },
            },
          };
        });
      } finally {
        inFlightPromises.delete(taskId);
        updateIsSyncing();
      }
    })();

    inFlightPromises.set(taskId, promise);
    return promise;
  };

  const runAllEligible = async (opts: { ignoreBackoff: boolean }) => {
    if (!isConnected()) return;

    const now = nowMs();
    setState((prev) => ({
      ...prev,
      lastRunAtMs: now,
    }));

    const snapshot = store.getSnapshot();
    const runIds: string[] = [];
    for (const taskId of taskById.keys()) {
      const state = snapshot.tasks[taskId];
      if (!state) continue;
      if (state.inFlight) continue;
      if (!opts.ignoreBackoff) {
        const next = state.nextAttemptAtMs;
        if (typeof next === "number" && next > now) continue;
      }
      runIds.push(taskId);
    }

    await Promise.all(runIds.map((id) => runTask(id)));
  };

  const handleConnected = async () => {
    // Reset per-task failure state on reconnect and attempt immediately.
    const now = nowMs();
    setState((prev) => {
      const nextTasks: Record<string, AutoSyncTaskState> = { ...prev.tasks };
      for (const taskId of taskById.keys()) {
        const prevTask = nextTasks[taskId];
        if (!prevTask) continue;
        nextTasks[taskId] = {
          ...prevTask,
          consecutiveFailures: 0,
          lastError: null,
          nextAttemptAtMs: now,
        };
      }
      return { ...prev, tasks: nextTasks };
    });

    await runAllEligible({ ignoreBackoff: true });
  };

  const tick = async () => {
    await runAllEligible({ ignoreBackoff: false });
  };

  const syncAllNow = async () => {
    if (!isConnected()) return;
    const now = nowMs();
    setState((prev) => ({
      ...prev,
      lastManualAtMs: now,
    }));
    await runAllEligible({ ignoreBackoff: true });
  };

  let intervalId: ReturnType<typeof setInterval> | null = null;
  if (start) {
    intervalId = setInterval(() => {
      void tick();
    }, intervalMs);
    if (typeof (intervalId as unknown as { unref?: () => void }).unref === "function") {
      (intervalId as unknown as { unref: () => void }).unref();
    }
  }

  const dispose = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  return { store, handleConnected, tick, syncAllNow, dispose };
}
