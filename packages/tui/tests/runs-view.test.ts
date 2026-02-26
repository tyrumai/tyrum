import { describe, expect, it } from "vitest";
import { getAttemptsForStep, getRunList, getStepsForRun } from "../src/runs-view.js";

describe("runs view helpers", () => {
  it("sorts runs by created_at desc", () => {
    const runsState = {
      runsById: {
        runA: {
          run_id: "runA",
          job_id: "jobA",
          key: "keyA",
          lane: "default",
          status: "running",
          attempt: 1,
          created_at: "2024-01-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
        runB: {
          run_id: "runB",
          job_id: "jobB",
          key: "keyB",
          lane: "default",
          status: "queued",
          attempt: 1,
          created_at: "2024-02-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    } as const;

    const runs = getRunList(runsState);
    expect(runs.map((run) => run.run_id)).toEqual(["runB", "runA"]);
  });

  it("sorts steps by step_index asc and attempts by attempt asc", () => {
    const runsState = {
      runsById: {
        runA: {
          run_id: "runA",
          job_id: "jobA",
          key: "keyA",
          lane: "default",
          status: "running",
          attempt: 1,
          created_at: "2024-01-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
      },
      stepsById: {
        step2: {
          step_id: "step2",
          run_id: "runA",
          step_index: 2,
          status: "queued",
          action: { type: "noop" },
          created_at: "2024-01-01T00:00:00.000Z",
        },
        step1: {
          step_id: "step1",
          run_id: "runA",
          step_index: 1,
          status: "running",
          action: { type: "noop" },
          created_at: "2024-01-01T00:00:00.000Z",
        },
      },
      attemptsById: {
        att2: {
          attempt_id: "att2",
          step_id: "step1",
          attempt: 2,
          status: "failed",
          started_at: "2024-01-01T00:00:00.000Z",
          finished_at: null,
          error: null,
          artifacts: [],
        },
        att1: {
          attempt_id: "att1",
          step_id: "step1",
          attempt: 1,
          status: "running",
          started_at: "2024-01-01T00:00:00.000Z",
          finished_at: null,
          error: null,
          artifacts: [],
        },
      },
      stepIdsByRunId: {
        runA: ["step2", "step1"],
      },
      attemptIdsByStepId: {
        step1: ["att2", "att1"],
      },
    } as const;

    const steps = getStepsForRun(runsState, "runA");
    expect(steps.map((step) => step.step_id)).toEqual(["step1", "step2"]);

    const attempts = getAttemptsForStep(runsState, "step1");
    expect(attempts.map((attempt) => attempt.attempt_id)).toEqual(["att1", "att2"]);
  });
});

