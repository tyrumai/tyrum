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

describe("Execution engine contracts", () => {
  it("parses a job record", () => {
    const job = ExecutionJob.parse({
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
    });
    expect(job.status).toBe("queued");
  });

  it("parses a run record", () => {
    const run = ExecutionRun.parse({
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      key: "agent:agent-1:main",
      lane: "main",
      status: "running",
      attempt: 1,
      created_at: "2026-02-19T12:00:00Z",
      started_at: "2026-02-19T12:00:01Z",
      finished_at: null,
    });
    expect(run.status).toBe("running");
  });

  it("parses a step record", () => {
    const step = ExecutionStep.parse({
      step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      step_index: 0,
      status: "running",
      action: { type: "Http", args: { url: "https://example.com" } },
      created_at: "2026-02-19T12:00:00Z",
    });
    expect(step.action.type).toBe("Http");
  });

  it("parses an attempt record with artifacts", () => {
    const attempt = ExecutionAttempt.parse({
      attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
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
    });
    expect(attempt.status).toBe("succeeded");
    expect(attempt.artifacts).toHaveLength(1);
  });

  it("parses attempt cost attribution", () => {
    const cost = AttemptCost.parse({
      duration_ms: 1234,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      usd_micros: 123_000,
      model: "gpt-4.1-mini",
      provider: "openai",
    });
    expect(cost.total_tokens).toBe(30);
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
      approval_id: 1,
    });
    expect(payload.reason).toBe("approval");
  });
});
