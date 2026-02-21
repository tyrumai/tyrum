import { describe, expect, it } from "vitest";
import {
  WorkflowRunRequest,
  WorkflowResumeRequest,
  WorkflowCancelRequest,
  WorkflowRunStatus,
} from "../src/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = "2026-02-20T10:00:00Z";
const AGENT_KEY = "agent:bot1:telegram:main";

describe("WorkflowRunRequest", () => {
  const valid = {
    key: AGENT_KEY,
    steps: [{ type: "Http", args: { url: "https://example.com" } }],
    trigger: { kind: "manual" as const },
  };

  it("parses a valid request", () => {
    const req = WorkflowRunRequest.parse(valid);
    expect(req.lane).toBe("main");
    expect(req.steps).toHaveLength(1);
  });

  it("rejects empty steps", () => {
    expect(() => WorkflowRunRequest.parse({ ...valid, steps: [] })).toThrow();
  });

  it("rejects invalid key", () => {
    expect(() => WorkflowRunRequest.parse({ ...valid, key: "bad" })).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() => WorkflowRunRequest.parse({ ...valid, extra: true })).toThrow();
  });
});

describe("WorkflowResumeRequest", () => {
  it("parses a valid request", () => {
    const req = WorkflowResumeRequest.parse({
      run_id: UUID,
      resume_token: "tok-abc",
    });
    expect(req.run_id).toBe(UUID);
  });

  it("rejects empty resume_token", () => {
    expect(() =>
      WorkflowResumeRequest.parse({ run_id: UUID, resume_token: "" }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      WorkflowResumeRequest.parse({
        run_id: UUID,
        resume_token: "tok",
        extra: 1,
      }),
    ).toThrow();
  });
});

describe("WorkflowCancelRequest", () => {
  it("parses a valid request", () => {
    const req = WorkflowCancelRequest.parse({ run_id: UUID });
    expect(req.run_id).toBe(UUID);
    expect(req.reason).toBeUndefined();
  });

  it("accepts optional reason", () => {
    const req = WorkflowCancelRequest.parse({
      run_id: UUID,
      reason: "user cancelled",
    });
    expect(req.reason).toBe("user cancelled");
  });
});

describe("WorkflowRunStatus", () => {
  const valid = {
    run_id: UUID,
    status: "running" as const,
    created_at: NOW,
    started_at: NOW,
    finished_at: null,
    step_count: 3,
    steps_completed: 1,
    budget_tokens: 1000,
    spent_tokens: 200,
  };

  it("parses a valid status", () => {
    const s = WorkflowRunStatus.parse(valid);
    expect(s.status).toBe("running");
    expect(s.step_count).toBe(3);
  });

  it("accepts null nullable fields", () => {
    const s = WorkflowRunStatus.parse({
      ...valid,
      started_at: null,
      budget_tokens: null,
      spent_tokens: null,
    });
    expect(s.started_at).toBeNull();
  });

  it("rejects negative step_count", () => {
    expect(() =>
      WorkflowRunStatus.parse({ ...valid, step_count: -1 }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      WorkflowRunStatus.parse({ ...valid, extra: true }),
    ).toThrow();
  });
});
