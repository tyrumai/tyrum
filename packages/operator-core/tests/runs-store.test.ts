import { describe, expect, it } from "vitest";
import { createRunsStore } from "../src/stores/runs-store.js";

describe("createRunsStore", () => {
  it("indexes runs, steps, and attempts (and dedupes ids)", () => {
    const { store, handleAttemptUpdated, handleRunUpdated, handleStepUpdated } = createRunsStore();

    handleRunUpdated({ run_id: "r-1" } as any);

    handleStepUpdated({ run_id: "r-1", step_id: "s-1" } as any);
    handleStepUpdated({ run_id: "r-1", step_id: "s-1" } as any);
    handleStepUpdated({ run_id: "r-1", step_id: "s-2" } as any);

    handleAttemptUpdated({ step_id: "s-1", attempt_id: "a-1" } as any);
    handleAttemptUpdated({ step_id: "s-1", attempt_id: "a-1" } as any);
    handleAttemptUpdated({ step_id: "s-1", attempt_id: "a-2" } as any);

    const snapshot = store.getSnapshot();
    expect(snapshot.runsById["r-1"]).toEqual(expect.objectContaining({ run_id: "r-1" }));
    expect(snapshot.stepsById["s-1"]).toEqual(expect.objectContaining({ step_id: "s-1" }));
    expect(snapshot.stepsById["s-2"]).toEqual(expect.objectContaining({ step_id: "s-2" }));
    expect(snapshot.attemptsById["a-1"]).toEqual(expect.objectContaining({ attempt_id: "a-1" }));
    expect(snapshot.attemptsById["a-2"]).toEqual(expect.objectContaining({ attempt_id: "a-2" }));
    expect(snapshot.stepIdsByRunId["r-1"]).toEqual(["s-1", "s-2"]);
    expect(snapshot.attemptIdsByStepId["s-1"]).toEqual(["a-1", "a-2"]);
  });
});

