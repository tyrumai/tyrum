import { describe, expect, it } from "vitest";
import {
  WorkflowRun,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkflowRunStepStatus,
  WorkflowRunTriggerKind,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Workflow run contracts", () => {
  const baseRun = {
    workflow_run_id: "11111111-2222-4333-8444-555555555555",
    tenant_id: "00000000-0000-4000-8000-000000000001",
    agent_id: "00000000-0000-4000-8000-000000000002",
    workspace_id: "00000000-0000-4000-8000-000000000003",
    run_key: "agent:default:automation:default:channel:heartbeat",
    conversation_key: "agent:default:automation:default:channel:heartbeat",
    status: "queued",
    trigger: {
      kind: "heartbeat",
      metadata: {
        schedule_id: "schedule-heartbeat",
      },
    },
    plan_id: "plan-heartbeat-1",
    request_id: "req-heartbeat-1",
    input: {
      source: "scheduler",
    },
    budgets: {
      max_duration_ms: 60_000,
    },
    policy_snapshot_id: null,
    attempt: 1,
    current_step_index: null,
    created_at: "2026-04-02T10:00:00Z",
    updated_at: "2026-04-02T10:00:00Z",
    started_at: null,
    finished_at: null,
    blocked_reason: null,
    blocked_detail: null,
    budget_overridden_at: null,
    lease_owner: null,
    lease_expires_at_ms: null,
    checkpoint: null,
    last_progress_at: null,
    last_progress: null,
  } as const;

  const baseStep = {
    tenant_id: baseRun.tenant_id,
    workflow_run_step_id: "66666666-7777-4888-8999-000000000000",
    workflow_run_id: baseRun.workflow_run_id,
    step_index: 0,
    status: "queued",
    action: {
      type: "Http",
      args: {
        url: "https://example.com",
      },
    },
    created_at: "2026-04-02T10:00:00Z",
    updated_at: "2026-04-02T10:00:00Z",
    started_at: null,
    finished_at: null,
    idempotency_key: null,
    postcondition: null,
    result: null,
    error: null,
    artifacts: [],
    metadata: null,
    cost: null,
    policy_snapshot_id: null,
    policy_decision: null,
    policy_applied_override_ids: null,
    attempt_count: 0,
    max_attempts: 1,
    timeout_ms: 60_000,
  } as const;

  it("parses a workflow run record", () => {
    const run = WorkflowRun.parse(baseRun);
    expect(run.run_key).toBe(baseRun.run_key);
    expect(run.trigger.kind).toBe("heartbeat");
  });

  it("rejects a workflow run record with a missing run_key", () => {
    const bad = { ...baseRun } as Record<string, unknown>;
    delete bad.run_key;
    expectRejects(WorkflowRun, bad);
  });

  it("parses a workflow run step record", () => {
    const step = WorkflowRunStep.parse(baseStep);
    expect(step.action.type).toBe("Http");
    expect(step.attempt_count).toBe(0);
  });

  it("rejects a workflow run step with a non-integer step_index", () => {
    expectRejects(WorkflowRunStep, { ...baseStep, step_index: "0" });
  });

  it("exports stable workflow status enums", () => {
    expect(WorkflowRunStatus.options).toContain("paused");
    expect(WorkflowRunStepStatus.options).toContain("skipped");
    expect(WorkflowRunTriggerKind.options).toContain("hook");
  });
});
