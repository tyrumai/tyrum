import { describe, expect, it } from "vitest";
import { getAttemptsForStep, getStepsForTurn, getTurnList } from "../src/turns-view.js";

describe("turns view helpers", () => {
  it("sorts turns by created_at desc", () => {
    const turnsState = {
      turnsById: {
        runA: {
          turn_id: "runA",
          job_id: "jobA",
          conversation_key: "conversation-a",
          status: "running",
          attempt: 1,
          created_at: "2024-01-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
        runB: {
          turn_id: "runB",
          job_id: "jobB",
          conversation_key: "conversation-b",
          status: "queued",
          attempt: 1,
          created_at: "2024-02-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByTurnId: {},
      attemptIdsByStepId: {},
    } as const;

    const turns = getTurnList(turnsState);
    expect(turns.map((turn) => turn.turn_id)).toEqual(["runB", "runA"]);
  });

  it("sorts steps by step_index asc and attempts by attempt asc", () => {
    const turnsState = {
      turnsById: {
        runA: {
          turn_id: "runA",
          job_id: "jobA",
          conversation_key: "conversation-a",
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
          turn_id: "runA",
          step_index: 2,
          status: "queued",
          action: { type: "noop" },
          created_at: "2024-01-01T00:00:00.000Z",
        },
        step1: {
          step_id: "step1",
          turn_id: "runA",
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
      stepIdsByTurnId: {
        runA: ["step2", "step1"],
      },
      attemptIdsByStepId: {
        step1: ["att2", "att1"],
      },
    } as const;

    const steps = getStepsForTurn(turnsState, "runA");
    expect(steps.map((step) => step.step_id)).toEqual(["step1", "step2"]);

    const attempts = getAttemptsForStep(turnsState, "step1");
    expect(attempts.map((attempt) => attempt.attempt_id)).toEqual(["att1", "att2"]);
  });
});
