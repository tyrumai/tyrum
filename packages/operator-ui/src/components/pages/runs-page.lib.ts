import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import type { RunsState } from "@tyrum/operator-app";

export interface RunTimelineEntry {
  step: ExecutionStep;
  attempts: ExecutionAttempt[];
}

export function sortRunsByCreatedAt(runs: ExecutionRun[]): ExecutionRun[] {
  return runs.toSorted((left, right) => {
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
}

export function buildRunTimeline(run: ExecutionRun, state: RunsState): RunTimelineEntry[] {
  const steps = (state.stepIdsByRunId[run.run_id] ?? [])
    .map((stepId) => state.stepsById[stepId])
    .filter((step): step is ExecutionStep => step !== undefined)
    .toSorted((left, right) => left.step_index - right.step_index);

  return steps.map((step) => {
    const attempts = (state.attemptIdsByStepId[step.step_id] ?? [])
      .map((attemptId) => state.attemptsById[attemptId])
      .filter((attempt): attempt is ExecutionAttempt => attempt !== undefined)
      .toSorted((left, right) => left.attempt - right.attempt);

    return { step, attempts };
  });
}
