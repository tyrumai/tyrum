import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface RunsState {
  runsById: Record<string, ExecutionRun>;
  stepsById: Record<string, ExecutionStep>;
  attemptsById: Record<string, ExecutionAttempt>;
  stepIdsByRunId: Record<string, string[]>;
  attemptIdsByStepId: Record<string, string[]>;
  agentKeyByRunId?: Record<string, string>;
}

export interface RunsStore extends ExternalStore<RunsState> {
  refreshRecent(input?: { limit?: number; statuses?: ExecutionRun["status"][] }): Promise<void>;
}

function addUniqueId(list: string[] | undefined, id: string): string[] {
  if (!list) return [id];
  if (list.includes(id)) return list;
  return [...list, id];
}

export function createRunsStore(ws: OperatorWsClient): {
  store: RunsStore;
  handleRunUpdated: (run: ExecutionRun) => void;
  handleStepUpdated: (step: ExecutionStep) => void;
  handleAttemptUpdated: (attempt: ExecutionAttempt) => void;
} {
  const { store, setState } = createStore<RunsState>({
    runsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
    agentKeyByRunId: {},
  });

  let refreshRecentRunId = 0;
  let activeRefreshRecentRunId: number | null = null;
  let bufferedRuns = new Map<string, ExecutionRun>();
  let bufferedSteps = new Map<string, ExecutionStep>();
  let bufferedAttempts = new Map<string, ExecutionAttempt>();

  function handleRunUpdated(run: ExecutionRun): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedRuns.set(run.run_id, run);
    }
    setState((prev) => ({
      ...prev,
      runsById: { ...prev.runsById, [run.run_id]: run },
    }));
  }

  function handleStepUpdated(step: ExecutionStep): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedSteps.set(step.step_id, step);
    }
    setState((prev) => ({
      ...prev,
      stepsById: { ...prev.stepsById, [step.step_id]: step },
      stepIdsByRunId: {
        ...prev.stepIdsByRunId,
        [step.run_id]: addUniqueId(prev.stepIdsByRunId[step.run_id], step.step_id),
      },
    }));
  }

  function handleAttemptUpdated(attempt: ExecutionAttempt): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedAttempts.set(attempt.attempt_id, attempt);
    }
    setState((prev) => ({
      ...prev,
      attemptsById: { ...prev.attemptsById, [attempt.attempt_id]: attempt },
      attemptIdsByStepId: {
        ...prev.attemptIdsByStepId,
        [attempt.step_id]: addUniqueId(
          prev.attemptIdsByStepId[attempt.step_id],
          attempt.attempt_id,
        ),
      },
    }));
  }

  async function refreshRecent(input?: {
    limit?: number;
    statuses?: ExecutionRun["status"][];
  }): Promise<void> {
    const runId = ++refreshRecentRunId;
    activeRefreshRecentRunId = runId;
    bufferedRuns = new Map<string, ExecutionRun>();
    bufferedSteps = new Map<string, ExecutionStep>();
    bufferedAttempts = new Map<string, ExecutionAttempt>();

    try {
      const result = await ws.runList({
        ...(input?.limit ? { limit: input.limit } : undefined),
        ...(input?.statuses && input.statuses.length > 0
          ? { statuses: input.statuses }
          : undefined),
      });
      if (activeRefreshRecentRunId !== runId) return;

      const nextRuns = new Map<string, ExecutionRun>();
      const nextSteps = new Map<string, ExecutionStep>();
      const nextAttempts = new Map<string, ExecutionAttempt>();
      const nextAgentKeys = new Map<string, string>();

      for (const item of result.runs) {
        nextRuns.set(item.run.run_id, item.run);
        if (item.agent_key) {
          nextAgentKeys.set(item.run.run_id, item.agent_key);
        }
      }
      for (const step of result.steps) {
        nextSteps.set(step.step_id, step);
      }
      for (const attempt of result.attempts) {
        nextAttempts.set(attempt.attempt_id, attempt);
      }
      for (const [id, run] of bufferedRuns) {
        nextRuns.set(id, run);
      }
      for (const [id, step] of bufferedSteps) {
        nextSteps.set(id, step);
      }
      for (const [id, attempt] of bufferedAttempts) {
        nextAttempts.set(id, attempt);
      }

      setState((prev) => {
        const runsById = { ...prev.runsById };
        const stepsById = { ...prev.stepsById };
        const attemptsById = { ...prev.attemptsById };
        const stepIdsByRunId = { ...prev.stepIdsByRunId };
        const attemptIdsByStepId = { ...prev.attemptIdsByStepId };
        const agentKeyByRunId = { ...prev.agentKeyByRunId };

        for (const run of nextRuns.values()) {
          runsById[run.run_id] = run;
        }
        for (const step of nextSteps.values()) {
          stepsById[step.step_id] = step;
          stepIdsByRunId[step.run_id] = addUniqueId(stepIdsByRunId[step.run_id], step.step_id);
        }
        for (const attempt of nextAttempts.values()) {
          attemptsById[attempt.attempt_id] = attempt;
          attemptIdsByStepId[attempt.step_id] = addUniqueId(
            attemptIdsByStepId[attempt.step_id],
            attempt.attempt_id,
          );
        }
        for (const [id, agentKey] of nextAgentKeys) {
          agentKeyByRunId[id] = agentKey;
        }

        return {
          ...prev,
          runsById,
          stepsById,
          attemptsById,
          stepIdsByRunId,
          attemptIdsByStepId,
          agentKeyByRunId,
        };
      });
    } finally {
      if (activeRefreshRecentRunId === runId) {
        activeRefreshRecentRunId = null;
        bufferedRuns = new Map<string, ExecutionRun>();
        bufferedSteps = new Map<string, ExecutionStep>();
        bufferedAttempts = new Map<string, ExecutionAttempt>();
      }
    }
  }

  return {
    store: {
      ...store,
      refreshRecent,
    },
    handleRunUpdated,
    handleStepUpdated,
    handleAttemptUpdated,
  };
}
