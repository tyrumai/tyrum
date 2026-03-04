import { describe, expect, it } from "vitest";
import {
  ExecutionAttempt,
  ExecutionAttemptStatus,
  ExecutionJob,
  ExecutionRunPausedPayload,
  ExecutionRun,
  ExecutionRunStatus,
  ExecutionStep,
  ExecutionStepStatus,
  AttemptCost,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Execution engine contracts", () => {
  const baseJob = {
    job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    key: "agent:agent-1:main",
    lane: "main",
    status: "queued",
    created_at: "2026-02-19T12:00:00Z",
    trigger: {
      kind: "session",
      key: "agent:agent-1:main",
      lane: "main",
    },
  } as const;

  const baseRun = {
    run_id: "550e8400-e29b-41d4-a716-446655440000",
    job_id: baseJob.job_id,
    key: "agent:agent-1:main",
    lane: "main",
    status: "running",
    attempt: 1,
    created_at: "2026-02-19T12:00:00Z",
    started_at: "2026-02-19T12:00:01Z",
    finished_at: null,
  } as const;

  const baseStep = {
    step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    run_id: baseRun.run_id,
    step_index: 0,
    status: "running",
    action: { type: "Http", args: { url: "https://example.com" } },
    created_at: "2026-02-19T12:00:00Z",
  } as const;

  const baseAttempt = {
    attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    step_id: baseStep.step_id,
    attempt: 1,
    status: "succeeded",
    started_at: "2026-02-19T12:00:01Z",
    finished_at: "2026-02-19T12:00:02Z",
    result: { status: 200 },
    error: null,
    artifacts: [
      {
        artifact_id: "550e8400-e29b-41d4-a716-446655440000",
        uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
        kind: "http_trace",
        created_at: "2026-02-19T12:00:02Z",
      },
    ],
  } as const;

  const baseCost = {
    duration_ms: 1234,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    usd_micros: 123_000,
    model: "gpt-4.1-mini",
    provider: "openai",
  } as const;

  it("parses a job record", () => {
    const job = ExecutionJob.parse(baseJob);
    expect(job.status).toBe("queued");
  });

  it("rejects a job record with wrong job_id type", () => {
    expectRejects(ExecutionJob, { ...baseJob, job_id: 123 });
  });

  it("rejects a job record missing trigger", () => {
    const bad = { ...baseJob } as Record<string, unknown>;
    delete bad.trigger;
    expectRejects(ExecutionJob, bad);
  });

  it("parses a run record", () => {
    const run = ExecutionRun.parse(baseRun);
    expect(run.status).toBe("running");
  });

  it("rejects a run record with wrong attempt type", () => {
    expectRejects(ExecutionRun, { ...baseRun, attempt: "1" });
  });

  it("rejects a run record missing started_at", () => {
    const bad = { ...baseRun } as Record<string, unknown>;
    delete bad.started_at;
    expectRejects(ExecutionRun, bad);
  });

  it("parses a step record", () => {
    const step = ExecutionStep.parse(baseStep);
    expect(step.action.type).toBe("Http");
  });

  it("rejects a step record with missing action", () => {
    const bad = { ...baseStep } as Record<string, unknown>;
    delete bad.action;
    expectRejects(ExecutionStep, bad);
  });

  it("rejects a step record with wrong step_index type", () => {
    expectRejects(ExecutionStep, { ...baseStep, step_index: "0" });
  });

  it("parses an attempt record with artifacts", () => {
    const attempt = ExecutionAttempt.parse(baseAttempt);
    expect(attempt.status).toBe("succeeded");
    expect(attempt.artifacts).toHaveLength(1);
  });

  it("rejects an attempt record with invalid status", () => {
    expectRejects(ExecutionAttempt, { ...baseAttempt, status: "ok" });
  });

  it("rejects an attempt record missing started_at", () => {
    const bad = { ...baseAttempt } as Record<string, unknown>;
    delete bad.started_at;
    expectRejects(ExecutionAttempt, bad);
  });

  it("parses attempt cost attribution", () => {
    const cost = AttemptCost.parse(baseCost);
    expect(cost.total_tokens).toBe(30);
  });

  it("rejects attempt cost with wrong token types", () => {
    expectRejects(AttemptCost, { ...baseCost, total_tokens: "30" });
  });

  it("rejects attempt cost with negative duration_ms", () => {
    expectRejects(AttemptCost, { ...baseCost, duration_ms: -1 });
  });

  it("exports stable status enums", () => {
    expect(ExecutionRunStatus.options).toContain("paused");
    expect(ExecutionStepStatus.options).toContain("failed");
    expect(ExecutionAttemptStatus.options).toContain("timed_out");
  });

  it("parses a run paused payload", () => {
    const payload = ExecutionRunPausedPayload.parse({
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "approval",
      approval_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    });
    expect(payload.reason).toBe("approval");
  });

  it("rejects a run paused payload with wrong approval_id type", () => {
    expectRejects(ExecutionRunPausedPayload, {
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "approval",
      approval_id: 1,
    });
  });

  it("rejects a run paused payload missing run_id", () => {
    const bad = {
      reason: "approval",
      approval_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    } as const;
    expectRejects(ExecutionRunPausedPayload, bad);
  });
});
