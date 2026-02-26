import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import { createStore, type ExternalStore } from "../store.js";

export interface RunsState {
  runsById: Record<string, ExecutionRun>;
  stepsById: Record<string, ExecutionStep>;
  attemptsById: Record<string, ExecutionAttempt>;
  stepIdsByRunId: Record<string, string[]>;
  attemptIdsByStepId: Record<string, string[]>;
}

export interface RunsStore extends ExternalStore<RunsState> {}

function addUniqueId(list: string[] | undefined, id: string): string[] {
  if (!list) return [id];
  if (list.includes(id)) return list;
  return [...list, id];
}

export function createRunsStore(): {
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
  });

  function handleRunUpdated(run: ExecutionRun): void {
    setState((prev) => ({
      ...prev,
      runsById: { ...prev.runsById, [run.run_id]: run },
    }));
  }

  function handleStepUpdated(step: ExecutionStep): void {
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

  return { store, handleRunUpdated, handleStepUpdated, handleAttemptUpdated };
}
