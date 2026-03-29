import { describe, expect, it } from "vitest";
import type { ExecutionAttempt, ExecutionStep, Turn } from "@tyrum/contracts";
import { createTurnsStore } from "../src/stores/turns-store.js";

describe("createTurnsStore", () => {
  it("indexes runs/steps/attempts and keeps id lists unique", () => {
    const { store, handleTurnUpdated, handleStepUpdated, handleAttemptUpdated } = createTurnsStore({
      runList: async () => ({ runs: [], steps: [], attempts: [] }),
    } as never);

    const run = { turn_id: "run-1" } as unknown as Turn;
    handleTurnUpdated(run);
    expect(store.getSnapshot().turnsById["run-1"]).toBe(run);

    const stepA = { step_id: "step-1", turn_id: "run-1" } as unknown as ExecutionStep;
    handleStepUpdated(stepA);
    expect(store.getSnapshot().stepsById["step-1"]).toBe(stepA);
    expect(store.getSnapshot().stepIdsByTurnId["run-1"]).toEqual(["step-1"]);

    handleStepUpdated(stepA);
    expect(store.getSnapshot().stepIdsByTurnId["run-1"]).toEqual(["step-1"]);

    const stepB = { step_id: "step-2", turn_id: "run-1" } as unknown as ExecutionStep;
    handleStepUpdated(stepB);
    expect(store.getSnapshot().stepIdsByTurnId["run-1"]).toEqual(["step-1", "step-2"]);

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

  it("hydrates and updates trigger kinds for recent turns", async () => {
    const run = { turn_id: "run-1" } as unknown as Turn;
    const { store, handleTurnUpdated } = createTurnsStore({
      turnList: async () => ({
        turns: [{ turn: run, trigger_kind: "heartbeat" as const }],
        steps: [],
        attempts: [],
      }),
    } as never);

    await store.refreshRecent();
    expect(store.getSnapshot().triggerKindByTurnId?.["run-1"]).toBe("heartbeat");

    handleTurnUpdated(run, "cron");
    expect(store.getSnapshot().triggerKindByTurnId?.["run-1"]).toBe("cron");
  });
});
