import { describe, expect, it } from "vitest";
import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/contracts";
import { createRunsStore } from "../src/stores/runs-store.js";

describe("createRunsStore", () => {
  it("indexes runs/steps/attempts and keeps id lists unique", () => {
    const { store, handleRunUpdated, handleStepUpdated, handleAttemptUpdated } = createRunsStore({
      runList: async () => ({ runs: [], steps: [], attempts: [] }),
    } as never);

    const run = { run_id: "run-1" } as unknown as ExecutionRun;
    handleRunUpdated(run);
    expect(store.getSnapshot().runsById["run-1"]).toBe(run);

    const stepA = { step_id: "step-1", run_id: "run-1" } as unknown as ExecutionStep;
    handleStepUpdated(stepA);
    expect(store.getSnapshot().stepsById["step-1"]).toBe(stepA);
    expect(store.getSnapshot().stepIdsByRunId["run-1"]).toEqual(["step-1"]);

    handleStepUpdated(stepA);
    expect(store.getSnapshot().stepIdsByRunId["run-1"]).toEqual(["step-1"]);

    const stepB = { step_id: "step-2", run_id: "run-1" } as unknown as ExecutionStep;
    handleStepUpdated(stepB);
    expect(store.getSnapshot().stepIdsByRunId["run-1"]).toEqual(["step-1", "step-2"]);

    const attemptA = { attempt_id: "attempt-1", step_id: "step-1" } as unknown as ExecutionAttempt;
    handleAttemptUpdated(attemptA);
    expect(store.getSnapshot().attemptsById["attempt-1"]).toBe(attemptA);
    expect(store.getSnapshot().attemptIdsByStepId["step-1"]).toEqual(["attempt-1"]);

    handleAttemptUpdated(attemptA);
    expect(store.getSnapshot().attemptIdsByStepId["step-1"]).toEqual(["attempt-1"]);

    const attemptB = { attempt_id: "attempt-2", step_id: "step-1" } as unknown as ExecutionAttempt;
    handleAttemptUpdated(attemptB);
    expect(store.getSnapshot().attemptIdsByStepId["step-1"]).toEqual(["attempt-1", "attempt-2"]);
  });
});
