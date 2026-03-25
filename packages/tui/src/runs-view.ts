import type { ExecutionAttempt, ExecutionStep, RunsState, Turn } from "@tyrum/operator-app/node";

export function getRunList(state: RunsState): Turn[] {
  return Object.values(state.runsById).toSorted((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    const aScore = Number.isFinite(aTime) ? aTime : 0;
    const bScore = Number.isFinite(bTime) ? bTime : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.turn_id.localeCompare(b.turn_id);
  });
}

export function getStepsForRun(state: RunsState, runId: string): ExecutionStep[] {
  return (state.stepIdsByRunId[runId] ?? [])
    .map((stepId) => state.stepsById[stepId])
    .filter((step): step is ExecutionStep => step !== undefined)
    .toSorted((a, b) => {
      if (a.step_index !== b.step_index) return a.step_index - b.step_index;
      return a.step_id.localeCompare(b.step_id);
    });
}

export function getAttemptsForStep(state: RunsState, stepId: string): ExecutionAttempt[] {
  return (state.attemptIdsByStepId[stepId] ?? [])
    .map((attemptId) => state.attemptsById[attemptId])
    .filter((attempt): attempt is ExecutionAttempt => attempt !== undefined)
    .toSorted((a, b) => {
      if (a.attempt !== b.attempt) return a.attempt - b.attempt;
      return a.attempt_id.localeCompare(b.attempt_id);
    });
}
