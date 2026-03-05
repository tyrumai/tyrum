import { describe, expect, it } from "vitest";
import type { RunsState } from "../../../operator-core/src/stores/runs-store.js";
import { buildRunTimeline, sortRunsByCreatedAt } from "../../src/components/pages/runs-page.lib.js";

describe("runs-page.lib", () => {
  it("sorts runs newest-first without mutating the input array", () => {
    const olderRun = {
      run_id: "11111111-1111-1111-1111-111111111111",
      job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      key: "older-run",
      lane: "main",
      status: "queued",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: null,
      finished_at: null,
    } as const;
    const newerRun = {
      run_id: "22222222-2222-2222-2222-222222222222",
      job_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      key: "newer-run",
      lane: "main",
      status: "running",
      attempt: 1,
      created_at: "2026-01-02T00:00:00.000Z",
      started_at: "2026-01-02T00:00:01.000Z",
      finished_at: null,
    } as const;

    const runs = [olderRun, newerRun];

    expect(sortRunsByCreatedAt(runs).map((run) => run.run_id)).toEqual([
      newerRun.run_id,
      olderRun.run_id,
    ]);
    expect(runs.map((run) => run.run_id)).toEqual([olderRun.run_id, newerRun.run_id]);
  });

  it("builds timelines with steps and attempts sorted by index", () => {
    const run = {
      run_id: "33333333-3333-3333-3333-333333333333",
      job_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      key: "sorted-run",
      lane: "main",
      status: "running",
      attempt: 1,
      created_at: "2026-01-03T00:00:00.000Z",
      started_at: "2026-01-03T00:00:01.000Z",
      finished_at: null,
    } as const;
    const firstStep = {
      step_id: "44444444-4444-4444-4444-444444444444",
      run_id: run.run_id,
      step_index: 1,
      status: "succeeded",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-03T00:00:02.000Z",
    } as const;
    const secondStep = {
      step_id: "55555555-5555-5555-5555-555555555555",
      run_id: run.run_id,
      step_index: 2,
      status: "running",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-03T00:00:03.000Z",
    } as const;
    const firstAttempt = {
      attempt_id: "66666666-6666-6666-6666-666666666666",
      step_id: secondStep.step_id,
      attempt: 1,
      status: "failed",
      started_at: "2026-01-03T00:00:04.000Z",
      finished_at: "2026-01-03T00:00:05.000Z",
      error: "boom",
      artifacts: [],
    } as const;
    const secondAttempt = {
      attempt_id: "77777777-7777-7777-7777-777777777777",
      step_id: secondStep.step_id,
      attempt: 2,
      status: "running",
      started_at: "2026-01-03T00:00:06.000Z",
      finished_at: null,
      error: null,
      artifacts: [],
    } as const;

    const state = {
      runsById: { [run.run_id]: run },
      stepsById: {
        [firstStep.step_id]: firstStep,
        [secondStep.step_id]: secondStep,
      },
      attemptsById: {
        [firstAttempt.attempt_id]: firstAttempt,
        [secondAttempt.attempt_id]: secondAttempt,
      },
      stepIdsByRunId: {
        [run.run_id]: [secondStep.step_id, "missing-step", firstStep.step_id],
      },
      attemptIdsByStepId: {
        [firstStep.step_id]: [],
        [secondStep.step_id]: [
          secondAttempt.attempt_id,
          "missing-attempt",
          firstAttempt.attempt_id,
        ],
      },
    } satisfies RunsState;

    const timeline = buildRunTimeline(run, state);

    expect(timeline.map(({ step }) => step.step_id)).toEqual([
      firstStep.step_id,
      secondStep.step_id,
    ]);
    expect(timeline[0]?.attempts).toEqual([]);
    expect(timeline[1]?.attempts.map((attempt) => attempt.attempt_id)).toEqual([
      firstAttempt.attempt_id,
      secondAttempt.attempt_id,
    ]);
  });
});
