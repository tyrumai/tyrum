import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { ExecutionEngineApprovalManager } from "../../src/modules/execution/engine/approval-manager.js";
import { ExecutionEngineEventEmitter } from "../../src/modules/execution/engine/event-emitter.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  action,
  enqueuePlan,
  drain,
  delay,
  mockCallCount,
} from "./execution-engine.test-support.js";

function registerCancelAndRetryTests(fixture: { db: () => SqliteDb }): void {
  it("emits run.cancelled when a run is cancelled", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-cancel-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    await expect(engine.cancelRun(runId, "operator cancelled")).resolves.toBe("cancelled");
    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types).toContain("run.cancelled");
  });

  it("retries a failed step until it succeeds (within max_attempts)", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-retry-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    await db.run("UPDATE execution_steps SET max_attempts = 2 WHERE run_id = ?", [runId]);
    let callCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        callCount += 1;
        if (callCount === 1) return { success: false, error: "transient" };
        return { success: true, result: { ok: true } };
      }),
    };
    await drain(engine, "w1", mockExecutor);
    const attemptRows = await db.all<{ attempt: number; status: string }>(
      "SELECT attempt, status FROM execution_attempts ORDER BY attempt ASC",
    );
    expect(attemptRows.map((r) => r.status)).toEqual(["failed", "succeeded"]);
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step!.status).toBe("succeeded");
  });

  it("requires approval to retry a state-changing step without an idempotency_key", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-retry-approval-1",
      requestId: "test-req-1",
      steps: [action("CLI")],
    });
    await db.run("UPDATE execution_steps SET max_attempts = 2 WHERE run_id = ?", [runId]);
    let callCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        callCount += 1;
        if (callCount === 1) return { success: false, error: "transient" };
        return { success: true, result: { ok: true } };
      }),
    };
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(1);
    const approval = await db.get<{ kind: string; resume_token: string | null }>(
      "SELECT kind, resume_token FROM approvals WHERE tenant_id = ? AND run_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(approval?.kind).toBe("retry");
    expect(approval?.resume_token).toBeTruthy();
    await engine.resumeRun(approval!.resume_token!);
    await drain(engine, "w1", mockExecutor);
    expect(mockCallCount(mockExecutor)).toBe(2);
    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("succeeded");
  });

  it("pauses a run when postcondition is missing evidence and issues a resume token", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-pause-1",
      requestId: "test-req-1",
      steps: [
        {
          type: "Http",
          args: { url: "https://example.com" },
          postcondition: { assertions: [{ type: "http_status", equals: 200 }] },
        },
      ],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", mockExecutor);
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("paused");
    expect(run!.paused_reason).toBe("takeover");
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step!.status).toBe("paused");
    const tokenRow = await db.get<{ token: string; run_id: string; revoked_at: string | null }>(
      "SELECT token, run_id, revoked_at FROM resume_tokens WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(tokenRow!.run_id).toBe(runId);
    expect(tokenRow!.revoked_at).toBeNull();
    const approvalRow = await db.get<{
      approval_id: string;
      kind: string;
      status: string;
      run_id: string | null;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, status, run_id, resume_token FROM approvals WHERE tenant_id = ? AND run_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(approvalRow).toBeTruthy();
    expect(approvalRow!.kind).toBe("takeover");
    expect(approvalRow!.status).toBe("pending");
    expect(approvalRow!.run_id).toBe(runId);
    expect(approvalRow!.resume_token).toBe(tokenRow!.token);
    const stepApproval = await db.get<{ approval_id: string | null }>(
      "SELECT approval_id FROM execution_steps WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(stepApproval!.approval_id).toBe(approvalRow!.approval_id);
  });

  it("resumes a paused run using a resume token", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-resume-1",
      requestId: "test-req-1",
      steps: [
        {
          type: "Http",
          args: { url: "https://example.com" },
          postcondition: { assertions: [{ type: "http_status", equals: 200 }] },
        },
      ],
    });
    const pausingExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", pausingExecutor);
    const token = (await db.get<{ token: string }>(
      "SELECT token FROM resume_tokens WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    ))!.token;
    const resumed = await engine.resumeRun(token);
    expect(resumed).toBe(runId);
    const resumingExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: true,
          result: { ok: true },
          evidence: { http: { status: 200 } },
        }),
      ),
    };
    await drain(engine, "w1", resumingExecutor);
    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("succeeded");
    const tokenRow = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE tenant_id = ? AND token = ?",
      [DEFAULT_TENANT_ID, token],
    );
    expect(tokenRow!.revoked_at).not.toBeNull();
  });
}

function registerIdempotencyAndConcurrencyTests(fixture: { db: () => SqliteDb }): void {
  it("short-circuits execution when an idempotency record already succeeded", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-idem-1",
      requestId: "test-req-1",
      steps: [{ ...action("Research"), idempotency_key: "idem-1" }],
    });
    const stepRow = await db.get<{ step_id: string; idempotency_key: string }>(
      "SELECT step_id, idempotency_key FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    await db.run(
      `INSERT INTO idempotency_records (tenant_id, scope_key, kind, idempotency_key, status, result_json) VALUES (?, ?, 'step', ?, 'succeeded', ?)`,
      [
        DEFAULT_TENANT_ID,
        stepRow!.step_id,
        stepRow!.idempotency_key,
        JSON.stringify({ cached: true }),
      ],
    );
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({ success: true, result: { shouldNotRun: true } }),
      ),
    };
    await drain(engine, "w1", mockExecutor);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
    const attempt = await db.get<{ status: string; result_json: string | null }>(
      "SELECT status, result_json FROM execution_attempts WHERE step_id = ?",
      [stepRow!.step_id],
    );
    expect(attempt!.status).toBe("succeeded");
    expect(JSON.parse(attempt!.result_json ?? "{}")).toEqual({ cached: true });
  });

  it("writes idempotency outcomes for succeeded steps", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-idem-write-1",
      requestId: "test-req-1",
      steps: [{ ...action("Research"), idempotency_key: "idem-write-1" }],
    });
    const stepRow = await db.get<{ step_id: string; idempotency_key: string }>(
      "SELECT step_id, idempotency_key FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", mockExecutor);
    const record = await db.get<{ status: string; result_json: string | null }>(
      `SELECT status, result_json FROM idempotency_records WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
      [stepRow!.step_id, stepRow!.idempotency_key],
    );
    expect(record?.status).toBe("succeeded");
    expect(JSON.parse(record?.result_json ?? "{}")).toEqual({ ok: true });
  });

  it("takes over a stale running attempt by cancelling it and re-queuing the step", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-takeover-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });
    const step = await db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    await db.run("UPDATE execution_steps SET status = 'running' WHERE step_id = ?", [
      step!.step_id,
    ]);
    await db.run(
      `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
      [DEFAULT_TENANT_ID, "attempt-1", step!.step_id, new Date().toISOString(), Date.now() - 1],
    );
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", mockExecutor);
    const attempts = await db.all<{ attempt: number; status: string }>(
      "SELECT attempt, status FROM execution_attempts WHERE tenant_id = ? AND step_id = ? ORDER BY attempt ASC",
      [DEFAULT_TENANT_ID, step!.step_id],
    );
    expect(attempts.map((a) => a.status)).toEqual(["cancelled", "succeeded"]);
  });

  it("enforces global concurrency limits using durable slots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyrum-concurrency-"));
    const dbPath = join(dir, "gateway.db");
    const dbA = openTestSqliteDb(dbPath);
    const dbB = openTestSqliteDb(dbPath);
    try {
      const engineA = new ExecutionEngine({ db: dbA, concurrencyLimits: { global: 1 } });
      const engineB = new ExecutionEngine({ db: dbB, concurrencyLimits: { global: 1 } });
      const { runId: run1 } = await enqueuePlan(engineA, {
        key: "agent:default:ui:thread-1",
        lane: "main",
        planId: "plan-concurrency-1",
        requestId: "req-1",
        workspaceId: "ws-1",
        steps: [action("CLI")],
      });
      await enqueuePlan(engineA, {
        key: "agent:default:ui:thread-2",
        lane: "main",
        planId: "plan-concurrency-2",
        requestId: "req-2",
        workspaceId: "ws-2",
        steps: [action("CLI")],
      });
      let unblock: ((value: StepResult) => void) | undefined;
      const blocked = new Promise<StepResult>((resolve) => {
        unblock = resolve;
      });
      const blockingExecutor: StepExecutor = { execute: vi.fn(async () => await blocked) };
      const fastExecutor: StepExecutor = {
        execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
      };
      const tick1 = engineA.workerTick({ workerId: "w1", executor: blockingExecutor });
      for (let i = 0; i < 50; i += 1) {
        const running = await dbB.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM execution_attempts a JOIN execution_steps s ON s.step_id = a.step_id WHERE s.run_id = ? AND a.status = 'running'`,
          [run1],
        );
        if ((running?.n ?? 0) === 1) break;
        await delay(10);
      }
      const slotInUse = await dbB.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM concurrency_slots WHERE scope = 'global' AND scope_id = 'global' AND attempt_id IS NOT NULL`,
      );
      expect(slotInUse?.n).toBe(1);
      const tick2Blocked = await engineB.workerTick({ workerId: "w2", executor: fastExecutor });
      expect(tick2Blocked).toBe(false);
      unblock?.({ success: true, result: { ok: true } });
      await tick1;
      const tick2NowRuns = await engineB.workerTick({ workerId: "w2", executor: fastExecutor });
      expect(tick2NowRuns).toBe(true);
    } finally {
      await dbA.close();
      await dbB.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("marks the current step failed and cancels queued siblings when retries are exhausted", async () => {
    const db = fixture.db();
    const nowIso = new Date(0).toISOString();
    const clock = () => ({ nowMs: 0, nowIso });
    const manager = new ExecutionEngineApprovalManager({
      clock,
      redactText: (value) => value,
      redactUnknown: (value) => value,
      eventEmitter: new ExecutionEngineEventEmitter({ clock, eventsEnabled: false }),
    });
    const engine = new ExecutionEngine({ db, clock });
    const { jobId, runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-retry-terminal-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Message", { body: "never runs" })],
    });
    const firstStep = await db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC LIMIT 1",
      [runId],
    );
    expect(firstStep?.step_id).toBeTruthy();
    await db.run(
      "UPDATE execution_jobs SET status = 'running' WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, jobId],
    );
    await db.run(
      "UPDATE execution_runs SET status = 'running', started_at = ? WHERE tenant_id = ? AND run_id = ?",
      [nowIso, DEFAULT_TENANT_ID, runId],
    );
    await db.run(
      "UPDATE execution_steps SET status = 'running' WHERE tenant_id = ? AND step_id = ?",
      [DEFAULT_TENANT_ID, firstStep!.step_id],
    );
    await db.run(
      `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "agent:agent-1:telegram-1:group:thread-1", "main", "w1", 60_000],
    );
    await db.transaction(async (tx) => {
      await manager.maybeRetryOrFailStep({
        tx,
        nowIso,
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        attemptNum: 1,
        maxAttempts: 1,
        stepId: firstStep!.step_id,
        runId,
        jobId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        key: "agent:agent-1:telegram-1:group:thread-1",
        lane: "main",
        workerId: "w1",
      });
    });
    const stepStatuses = await db.all<{ step_index: number; status: string }>(
      "SELECT step_index, status FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
      [runId],
    );
    expect(stepStatuses).toEqual([
      { step_index: 0, status: "failed" },
      { step_index: 1, status: "cancelled" },
    ]);
    const run = await db.get<{ status: string; finished_at: string | null }>(
      "SELECT status, finished_at FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(run).toEqual({ status: "failed", finished_at: nowIso });
    const job = await db.get<{ status: string }>(
      "SELECT status FROM execution_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, jobId],
    );
    expect(job?.status).toBe("failed");
    const remainingLaneLease = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lane_leases WHERE tenant_id = ? AND key = ? AND lane = ?",
      [DEFAULT_TENANT_ID, "agent:agent-1:telegram-1:group:thread-1", "main"],
    );
    expect(remainingLaneLease?.n).toBe(0);
  });

  it("does not retry policy failures even when max_attempts is greater than one", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-policy-no-retry-1",
      requestId: "test-req-1",
      steps: [action("CLI")],
    });
    await db.run("UPDATE execution_steps SET max_attempts = 5 WHERE run_id = ?", [runId]);

    const policyFailureExecutor: StepExecutor = {
      execute: vi.fn(
        async (): Promise<StepResult> => ({
          success: false,
          error: "policy denied bash",
          failureKind: "policy",
        }),
      ),
    };

    await drain(engine, "w1", policyFailureExecutor);

    expect(mockCallCount(policyFailureExecutor)).toBe(1);
    const attempts = await db.all<{ attempt: number; status: string }>(
      "SELECT attempt, status FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) ORDER BY attempt ASC",
      [runId],
    );
    expect(attempts).toEqual([{ attempt: 1, status: "failed" }]);
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step?.status).toBe("failed");
    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("failed");
  });
}

export function registerRetryCancelTests(fixture: { db: () => SqliteDb }): void {
  registerCancelAndRetryTests(fixture);
  registerIdempotencyAndConcurrencyTests(fixture);
}
