import { expect, it, vi } from "vitest";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { action, enqueuePlan, drain, mockCallCount } from "./execution-engine.test-support.js";

function registerBudgetTests(fixture: { db: () => SqliteDb }): void {
  it("does not reset started_at or re-emit run.started when resuming a paused run", async () => {
    const db = fixture.db();
    const startedAtIso = "2026-02-24T00:00:00.000Z";
    let nowMs = Date.parse(startedAtIso);
    const clock = () => ({ nowMs, nowIso: new Date(nowMs).toISOString() });
    const engine = new ExecutionEngine({ db, clock });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-resume-started-at-1",
      requestId: "req-resume-started-at-1",
      budgets: { max_usd_micros: 5 },
      steps: [action("Research"), action("Research")],
    });
    let calls = 0;
    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        calls += 1;
        if (calls === 1) return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        return { success: true, result: { ok: true } };
      }),
    };
    expect(await engine.workerTick({ workerId: "w1", executor })).toBe(true);
    const before = await db.get<{ started_at: string | null }>(
      "SELECT started_at FROM execution_runs LIMIT 1",
    );
    expect(before?.started_at).toBe(startedAtIso);
    expect(await engine.workerTick({ workerId: "w1", executor })).toBe(true);
    const approval = await db.get<{ resume_token: string | null }>(
      "SELECT resume_token FROM approvals WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.resume_token).toBeTruthy();
    await engine.resumeRun(approval!.resume_token!);
    nowMs += 60_000;
    await drain(engine, "w1", executor);
    const after = await db.get<{ started_at: string | null }>(
      "SELECT started_at FROM execution_runs LIMIT 1",
    );
    expect(after?.started_at).toBe(startedAtIso);
    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types.filter((type) => type === "run.started")).toHaveLength(1);
  });

  it("pauses when a run budget is exceeded and resumes after approval", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-budget-1",
      requestId: "test-req-1",
      budgets: { max_usd_micros: 5 },
      steps: [action("Research"), action("Research")],
    });
    let calls = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        calls += 1;
        if (calls === 1) return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        return { success: true, result: { ok: true } };
      }),
    };
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(1);
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(1);
    const outboxPaused = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const pausedTypes = outboxPaused
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(pausedTypes).toContain("run.paused");
    const runPaused = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(runPaused?.status).toBe("paused");
    expect(runPaused?.paused_reason).toBe("budget");
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("budget");
    expect(approval?.resume_token).toBeTruthy();
    await engine.resumeRun(approval!.resume_token!);
    const outboxResumed = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const resumedTypes = outboxResumed
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(resumedTypes).toContain("run.resumed");
    const runResumed = await db.get<{ status: string; budget_overridden_at: string | null }>(
      "SELECT status, budget_overridden_at FROM execution_runs LIMIT 1",
    );
    expect(runResumed?.status).toBe("queued");
    expect(runResumed?.budget_overridden_at).toBeTruthy();
    await drain(engine, "w1", mockExecutor);
    const runDone = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(runDone?.status).toBe("succeeded");
  });

  it("does not emit run.resumed when a resume token is used after the run is no longer paused", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-budget-cancel-1",
      requestId: "test-req-1",
      budgets: { max_usd_micros: 5 },
      steps: [action("Research"), action("Research")],
    });
    let calls = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        calls += 1;
        if (calls === 1) return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        return { success: true, result: { ok: true } };
      }),
    };
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(1);
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(1);
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("budget");
    expect(approval?.resume_token).toBeTruthy();
    expect(await engine.cancelRun(runId, "cancelled by test")).toBe("cancelled");
    const resumed = await engine.resumeRun(approval!.resume_token!);
    expect(resumed).toBeUndefined();
    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types).toContain("run.cancelled");
    expect(types).not.toContain("run.resumed");
  });
}

function registerApprovalResumeTests(fixture: { db: () => SqliteDb }): void {
  it("pauses and resumes when the executor returns an approval request", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-executor-pause-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    let calls = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        calls += 1;
        if (calls === 1) {
          return {
            success: true,
            pause: {
              kind: "policy",
              prompt: "Approve execution of 'webfetch'",
              detail: "approval required for tool 'webfetch'",
              context: {
                source: "llm-step-tool-execution",
                tool_id: "webfetch",
                tool_call_id: "tc-1",
              },
            },
            cost: { duration_ms: 1 },
          };
        }
        return { success: true, result: { ok: true }, cost: { duration_ms: 1 } };
      }),
    };
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(calls).toBe(1);
    const pausedRun = await db.get<{
      status: string;
      paused_reason: string | null;
      paused_detail: string | null;
    }>("SELECT status, paused_reason, paused_detail FROM execution_runs LIMIT 1");
    expect(pausedRun?.status).toBe("paused");
    expect(pausedRun?.paused_reason).toBe("policy");
    expect(pausedRun?.paused_detail).toContain("webfetch");
    const pausedStep = await db.get<{ status: string; approval_id: string | null }>(
      "SELECT status, approval_id FROM execution_steps LIMIT 1",
    );
    expect(pausedStep?.status).toBe("paused");
    expect(pausedStep?.approval_id).toBeTruthy();
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      status: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, status, resume_token FROM approvals WHERE tenant_id = ? ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.status).toBe("pending");
    expect(approval?.resume_token).toBeTruthy();
    const approvalOutbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const approvalMessages = approvalOutbox
      .map(
        (row) =>
          JSON.parse(row.payload_json) as { message?: { type?: string }; audience?: unknown },
      )
      .filter(
        (row) =>
          row.message?.type === "approval.requested" || row.message?.type === "approval.request",
      );
    expect(approvalMessages).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({ type: "approval.requested" }),
        audience: { roles: ["client"], required_scopes: ["operator.approvals"] },
      }),
      expect.objectContaining({
        message: expect.objectContaining({ type: "approval.request" }),
        audience: { roles: ["client"], required_scopes: ["operator.approvals"] },
      }),
    ]);
    const approvalDal = new ApprovalDal(db);
    await approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval!.approval_id,
      decision: "approved",
      reason: "approved in test",
    });
    await engine.resumeRun(approval!.resume_token!);
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(calls).toBe(2);
    await drain(engine, "w1", mockExecutor);
    const completedRun = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs LIMIT 1",
    );
    expect(completedRun?.status).toBe("succeeded");
  });

  it("revokes existing resume tokens when cancelling an already-cancelled run", async () => {
    const db = fixture.db();
    const nowIso = "2026-02-24T00:00:00.000Z";
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.parse(nowIso), nowIso }),
    });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-cancel-idempotent-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const token = "resume-token-preexisting-1";
    await db.run("INSERT INTO resume_tokens (tenant_id, token, run_id) VALUES (?, ?, ?)", [
      DEFAULT_TENANT_ID,
      token,
      runId,
    ]);
    await db.run(
      "UPDATE execution_runs SET status = 'cancelled' WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    const before = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE tenant_id = ? AND token = ?",
      [DEFAULT_TENANT_ID, token],
    );
    expect(before?.revoked_at).toBeNull();
    await expect(engine.cancelRun(runId, "idempotent cleanup")).resolves.toBe("cancelled");
    const after = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE tenant_id = ? AND token = ?",
      [DEFAULT_TENANT_ID, token],
    );
    expect(after?.revoked_at).toBe(nowIso);
  });
}

export function registerBudgetPauseTests(fixture: { db: () => SqliteDb }): void {
  registerBudgetTests(fixture);
  registerApprovalResumeTests(fixture);
}
