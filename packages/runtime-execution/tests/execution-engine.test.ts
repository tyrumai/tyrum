import { describe, expect, it, vi } from "vitest";
import type {
  ExecuteAttemptOptions,
  ExecutionDb,
  RunnableRunRow,
  StepClaimOutcome,
  StepExecutor,
} from "../src/index.js";
import { ExecutionEngine } from "../src/index.js";

function createDb(): ExecutionDb {
  const db: ExecutionDb = {
    get: vi.fn(async () => undefined),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 0 })),
    transaction: async (fn) => await fn(db),
  };
  return db;
}

function createExecutor(): StepExecutor {
  return {
    execute: vi.fn(async () => ({ success: true })),
  };
}

function createRun(): RunnableRunRow {
  return {
    tenant_id: "tenant-1",
    run_id: "run-1",
    job_id: "job-1",
    agent_id: "agent-1",
    key: "agent:agent-1:telegram-1:group:thread-1",
    status: "queued",
    trigger_json: JSON.stringify({ metadata: { plan_id: "plan-123" } }),
    workspace_id: "workspace-1",
    policy_snapshot_id: null,
  };
}

function createClaimedOutcome(): StepClaimOutcome {
  return {
    kind: "claimed",
    tenantId: "tenant-1",
    agentId: "agent-1",
    runId: "run-1",
    jobId: "job-1",
    workspaceId: "workspace-1",
    key: "agent:agent-1:telegram-1:group:thread-1",
    triggerJson: JSON.stringify({ metadata: { plan_id: "plan-123" } }),
    step: {
      tenant_id: "tenant-1",
      step_id: "step-1",
      run_id: "run-1",
      step_index: 2,
      status: "queued",
      action_json: JSON.stringify({ type: "Research", args: { query: "status" } }),
      created_at: new Date().toISOString(),
      idempotency_key: null,
      postcondition_json: null,
      approval_id: null,
      max_attempts: 3,
      timeout_ms: 45_000,
    },
    attempt: {
      attemptId: "attempt-1",
      attemptNum: 1,
    },
  };
}

describe("ExecutionEngine", () => {
  it("persists explicit conversation linkage when enqueueing a conversation-backed run", async () => {
    const db = createDb();
    const engine = new ExecutionEngine({
      db,
      scopeResolver: {
        resolveExecutionAgentId: vi.fn(async () => "agent-1"),
        resolveWorkspaceId: vi.fn(async () => "workspace-1"),
        ensureMembership: vi.fn(async () => undefined),
      },
      releaseConcurrencySlotsTx: vi.fn(async () => undefined),
      listRunnableRunCandidates: vi.fn(async () => []),
      tryAcquireRunConversationLease: vi.fn(async () => true),
      claimStepExecution: vi.fn(async () => ({ kind: "noop" })),
      executeAttempt: vi.fn(async (_opts: ExecuteAttemptOptions) => true),
      emitTurnUpdatedTx: vi.fn(async () => undefined),
      emitStepUpdatedTx: vi.fn(async () => undefined),
      emitAttemptUpdatedTx: vi.fn(async () => undefined),
      emitTurnQueuedTx: vi.fn(async () => undefined),
      emitTurnResumedTx: vi.fn(async () => undefined),
      emitTurnCancelledTx: vi.fn(async () => undefined),
    });

    await engine.enqueuePlan({
      tenantId: "tenant-1",
      key: "agent:default:ui:default:channel:thread-1",
      conversationId: "conversation-1",
      workspaceKey: "default",
      planId: "plan-1",
      requestId: "req-1",
      steps: [{ type: "Research", args: { query: "status" } }],
    });

    const firstInsert = vi.mocked(db.run).mock.calls[0];
    expect(firstInsert?.[0]).toContain("conversation_id");
    expect(firstInsert?.[0]).toContain("VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)");
    expect(firstInsert?.[1]).toEqual(
      expect.arrayContaining(["tenant-1", "agent-1", "workspace-1", "conversation-1"]),
    );
  });

  it("routes claimed steps through the extracted execution core", async () => {
    const executeAttempt = vi.fn(async (_opts: ExecuteAttemptOptions) => true);
    const listRunnableRunCandidates = vi.fn(async () => [createRun()]);
    const tryAcquireRunConversationLease = vi.fn(async () => true);
    const claimStepExecution = vi.fn(async () => createClaimedOutcome());

    const engine = new ExecutionEngine({
      db: createDb(),
      clock: () => ({ nowMs: 1000, nowIso: "2026-01-01T00:00:01.000Z" }),
      scopeResolver: {
        resolveExecutionAgentId: vi.fn(async () => "agent-1"),
        resolveWorkspaceId: vi.fn(async () => "workspace-1"),
        ensureMembership: vi.fn(async () => undefined),
      },
      releaseConcurrencySlotsTx: vi.fn(async () => undefined),
      listRunnableRunCandidates,
      tryAcquireRunConversationLease,
      claimStepExecution,
      executeAttempt,
      emitTurnUpdatedTx: vi.fn(async () => undefined),
      emitStepUpdatedTx: vi.fn(async () => undefined),
      emitAttemptUpdatedTx: vi.fn(async () => undefined),
      emitTurnQueuedTx: vi.fn(async () => undefined),
      emitTurnResumedTx: vi.fn(async () => undefined),
      emitTurnCancelledTx: vi.fn(async () => undefined),
    });

    const worked = await engine.workerTick({
      workerId: "worker-1",
      executor: createExecutor(),
    });

    expect(worked).toBe(true);
    expect(listRunnableRunCandidates).toHaveBeenCalledWith(undefined);
    expect(tryAcquireRunConversationLease).toHaveBeenCalledWith(createRun(), "worker-1", 1000);
    expect(claimStepExecution).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: "run-1" }),
      "worker-1",
      expect.objectContaining({ nowMs: 1000 }),
    );
    expect(executeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-123",
        runId: "run-1",
        stepIndex: 2,
        timeoutMs: 45_000,
        attemptId: "attempt-1",
        attemptNum: 1,
      }),
    );
  });

  it("skips noop claims without invoking the attempt executor", async () => {
    const executeAttempt = vi.fn(async (_opts: ExecuteAttemptOptions) => true);

    const engine = new ExecutionEngine({
      db: createDb(),
      clock: () => ({ nowMs: 50, nowIso: "2026-01-01T00:00:00.050Z" }),
      scopeResolver: {
        resolveExecutionAgentId: vi.fn(async () => "agent-1"),
        resolveWorkspaceId: vi.fn(async () => "workspace-1"),
        ensureMembership: vi.fn(async () => undefined),
      },
      releaseConcurrencySlotsTx: vi.fn(async () => undefined),
      listRunnableRunCandidates: vi.fn(async () => [createRun()]),
      tryAcquireRunConversationLease: vi.fn(async () => true),
      claimStepExecution: vi.fn(async () => ({ kind: "noop" })),
      executeAttempt,
      emitTurnUpdatedTx: vi.fn(async () => undefined),
      emitStepUpdatedTx: vi.fn(async () => undefined),
      emitAttemptUpdatedTx: vi.fn(async () => undefined),
      emitTurnQueuedTx: vi.fn(async () => undefined),
      emitTurnResumedTx: vi.fn(async () => undefined),
      emitTurnCancelledTx: vi.fn(async () => undefined),
    });

    const worked = await engine.workerTick({
      workerId: "worker-2",
      executor: createExecutor(),
    });

    expect(worked).toBe(false);
    expect(executeAttempt).not.toHaveBeenCalled();
  });
});
