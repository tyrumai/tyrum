import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyBundle, type ActionPrimitive } from "@tyrum/schemas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import {
  sha256HexFromString,
  stableJsonStringify,
} from "../../src/modules/policy/canonical-json.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { defaultPolicyBundle } from "../../src/modules/policy/bundle-loader.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb, RunResult } from "../../src/statestore/types.js";

function action(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return {
    type,
    args: args ?? {},
  };
}

async function drain(
  engine: ExecutionEngine,
  workerId: string,
  executor: StepExecutor,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const worked = await engine.workerTick({ workerId, executor });
    if (!worked) return;
  }
  throw new Error("worker did not become idle after 25 ticks");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AbortableTx implements SqlDb {
  readonly kind: SqlDb["kind"];
  private aborted = false;

  constructor(
    private readonly inner: SqlDb,
    private readonly opts: { abortOnSql: (sql: string) => boolean },
  ) {
    this.kind = inner.kind;
  }

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
    return await this.execWithAbortHandling(() => this.inner.get<T>(sql, params), sql);
  }

  async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return await this.execWithAbortHandling(() => this.inner.all<T>(sql, params), sql);
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    return await this.execWithAbortHandling(() => this.inner.run(sql, params), sql);
  }

  async exec(sql: string): Promise<void> {
    await this.execWithAbortHandling(() => this.inner.exec(sql), sql);
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    return await this.inner.transaction(fn);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  private async execWithAbortHandling<T>(fn: () => Promise<T>, sql: string): Promise<T> {
    const normalized = sql.trim().toUpperCase();
    const isRollback = normalized === "ROLLBACK" || normalized.startsWith("ROLLBACK TO SAVEPOINT ");
    if (this.aborted && !isRollback) {
      throw new Error("current transaction is aborted, commands ignored until end of transaction");
    }

    if (this.opts.abortOnSql(sql)) {
      this.aborted = true;
      throw new Error("synthetic statement failure");
    }

    try {
      const res = await fn();
      if (isRollback) {
        this.aborted = false;
      }
      return res;
    } catch (err) {
      this.aborted = true;
      throw err;
    }
  }
}

describe("ExecutionEngine (normalized)", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("creates normalized execution records for a plan", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { jobId, runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-test-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Message", { body: "hi" })],
    });

    const jobCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_jobs WHERE job_id = ?",
      [jobId],
    );
    expect(jobCount!.n).toBe(1);

    const runCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(runCount!.n).toBe(1);

    const stepCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(stepCount!.n).toBe(2);
  });

  it("normalizes trigger_json even when provided trigger is missing kind", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-trigger-1",
      requestId: "req-trigger-1",
      steps: [action("Research")],
      trigger: {
        key: "agent:agent-1:telegram-1:group:thread-1",
        lane: "main",
        metadata: { source: "test" },
      } as unknown as never,
    });

    const job = await db.get<{ trigger_json: string }>(
      "SELECT trigger_json FROM execution_jobs LIMIT 1",
    );
    const trigger = JSON.parse(job!.trigger_json) as { kind?: string; key?: string; lane?: string };
    expect(trigger.kind).toBe("session");
    expect(trigger.key).toBe("agent:agent-1:telegram-1:group:thread-1");
    expect(trigger.lane).toBe("main");
  });

  it("emits run.queued when enqueueing a plan", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-queued-1",
      requestId: "req-queued-1",
      steps: [action("Research")],
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types.filter((type) => type === "run.queued")).toHaveLength(1);
    expect(types).not.toContain("run.started");
    expect(types).not.toContain("run.completed");
    expect(types).not.toContain("run.failed");
  });

  it("emits simple run lifecycle events with { run_id } payload", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const runId = "550e8400-e29b-41d4-a716-446655440000";
    const typesToEmit = [
      "run.queued",
      "run.started",
      "run.resumed",
      "run.completed",
      "run.failed",
    ] as const;

    await db.transaction(async (tx) => {
      const engineAny = engine as unknown as { emitRunIdEventTx?: unknown } & {
        emitRunIdEventTx: (tx: unknown, type: string, runId: string) => Promise<void>;
      };
      expect(typeof engineAny.emitRunIdEventTx).toBe("function");
      for (const type of typesToEmit) {
        await engineAny.emitRunIdEventTx(tx, type, runId);
      }
    });

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    expect(outbox).toHaveLength(typesToEmit.length);

    const messages = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: Record<string, unknown> })
      .map((row) => row.message)
      .filter(
        (value): value is Record<string, unknown> => Boolean(value) && typeof value === "object",
      );

    for (let idx = 0; idx < typesToEmit.length; idx += 1) {
      const msg = messages[idx]!;
      expect(msg["type"]).toBe(typesToEmit[idx]);
      expect(msg["scope"]).toEqual({ kind: "run", run_id: runId });
      expect(msg["payload"]).toEqual({ run_id: runId });
    }
  });

  it("preserves heartbeat trigger kind when provided", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "heartbeat",
      planId: "plan-trigger-heartbeat-1",
      requestId: "req-trigger-heartbeat-1",
      steps: [action("Research")],
      trigger: {
        kind: "heartbeat",
        key: "agent:agent-1:telegram-1:group:thread-1",
        lane: "heartbeat",
        metadata: { source: "test" },
      } as unknown as never,
    });

    const job = await db.get<{ trigger_json: string }>(
      "SELECT trigger_json FROM execution_jobs LIMIT 1",
    );
    const trigger = JSON.parse(job!.trigger_json) as { kind?: string; lane?: string };
    expect(trigger.kind).toBe("heartbeat");
    expect(trigger.lane).toBe("heartbeat");
  });

  it("preserves webhook trigger kind when provided", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "cron:webhook-1",
      lane: "cron",
      planId: "plan-trigger-webhook-1",
      requestId: "req-trigger-webhook-1",
      steps: [action("Research")],
      trigger: {
        kind: "webhook",
        key: "cron:webhook-1",
        lane: "cron",
        metadata: { source: "test" },
      } as unknown as never,
    });

    const job = await db.get<{ trigger_json: string }>(
      "SELECT trigger_json FROM execution_jobs LIMIT 1",
    );
    const trigger = JSON.parse(job!.trigger_json) as { kind?: string; lane?: string };
    expect(trigger.kind).toBe("webhook");
    expect(trigger.lane).toBe("cron");
  });

  it("emits run.started and run.completed when a run succeeds", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-run-events-succeeded-1",
      requestId: "req-run-events-succeeded-1",
      steps: [action("Research")],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    await drain(engine, "w1", executor);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types.filter((type) => type === "run.queued")).toHaveLength(1);
    expect(types.filter((type) => type === "run.started")).toHaveLength(1);
    expect(types.filter((type) => type === "run.completed")).toHaveLength(1);
    expect(types.filter((type) => type === "run.failed")).toHaveLength(0);
  });

  it("allows lane=main model-only steps to run while a workspace lease is held", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });

    await db.run(
      `INSERT INTO workspace_leases (workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["default", "other-worker", 60_000],
    );

    await engine.enqueuePlan({
      key: "agent:default:test",
      lane: "main",
      planId: "plan-workspace-lease-main-1",
      requestId: "req-workspace-lease-main-1",
      steps: [action("Decide", { ok: true })],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    await drain(engine, "w-main", executor);

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      1,
    );

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");
  });

  it("blocks workspace-mutating tool steps while a workspace lease is held", async () => {
    db = openTestSqliteDb();

    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: 0, nowIso }),
    });

    await db.run(
      `INSERT INTO workspace_leases (workspace_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)`,
      ["default", "other-worker", 60_000],
    );

    await engine.enqueuePlan({
      key: "agent:default:test",
      lane: "subagent",
      planId: "plan-workspace-lease-cli-1",
      requestId: "req-workspace-lease-cli-1",
      steps: [action("CLI", { cmd: "echo", args: ["hi"] })],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    expect(await engine.workerTick({ workerId: "w-subagent", executor })).toBe(false);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps ORDER BY step_index ASC LIMIT 1",
    );
    expect(step?.status).toBe("queued");
  });

  it("emits run.failed when a run exhausts retry attempts", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-run-events-failed-1",
      requestId: "req-run-events-failed-1",
      steps: [action("Research")],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: false, error: "boom" })),
    };

    await drain(engine, "w1", executor);

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("failed");

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types.filter((type) => type === "run.queued")).toHaveLength(1);
    expect(types.filter((type) => type === "run.started")).toHaveLength(1);
    expect(types.filter((type) => type === "run.failed")).toHaveLength(1);
    expect(types.filter((type) => type === "run.completed")).toHaveLength(0);
  });

  it("does not reset started_at or re-emit run.started when resuming a paused run", async () => {
    db = openTestSqliteDb();

    const startedAtIso = "2026-02-24T00:00:00.000Z";
    let nowMs = Date.parse(startedAtIso);
    const clock = () => ({ nowMs, nowIso: new Date(nowMs).toISOString() });

    const engine = new ExecutionEngine({ db, clock });
    await engine.enqueuePlan({
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
        if (calls === 1) {
          return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        }
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
      "SELECT resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
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

  it("worker executes a 2-step plan and completes the run", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-test-2",
      requestId: "test-req-1",
      steps: [action("Research"), action("Message", { body: "done" })],
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run!.status).toBe("succeeded");

    const job = await db.get<{ status: string }>("SELECT status FROM execution_jobs LIMIT 1");
    expect(job!.status).toBe("completed");
  });

  it("pauses when a run budget is exceeded and resumes after approval", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
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
        if (calls === 1) {
          return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        }
        return { success: true, result: { ok: true } };
      }),
    };

    // First tick executes step 0 and records cost.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    // Second tick pauses before starting step 1 due to the run budget.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

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

    const approval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
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
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    const { runId } = await engine.enqueuePlan({
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
        if (calls === 1) {
          return { success: true, result: { ok: true }, cost: { usd_micros: 10 } };
        }
        return { success: true, result: { ok: true } };
      }),
    };

    // First tick executes step 0 and records cost.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    // Second tick pauses before starting step 1 due to the run budget.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    const approval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
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

  it("revokes existing resume tokens when cancelling an already-cancelled run", async () => {
    db = openTestSqliteDb();

    const nowIso = "2026-02-24T00:00:00.000Z";
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.parse(nowIso), nowIso }),
    });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-cancel-idempotent-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const token = "resume-token-preexisting-1";
    await db.run("INSERT INTO resume_tokens (token, run_id) VALUES (?, ?)", [token, runId]);

    await db.run("UPDATE execution_runs SET status = 'cancelled' WHERE run_id = ?", [runId]);

    const before = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [token],
    );
    expect(before?.revoked_at).toBeNull();

    await expect(engine.cancelRun(runId, "idempotent cleanup")).resolves.toBe("cancelled");

    const after = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [token],
    );
    expect(after?.revoked_at).toBe(nowIso);
  });

  it("pauses when policy requires approval for a step and resumes after approval", async () => {
    db = openTestSqliteDb();

    const snapshotDal = new PolicySnapshotDal(db);
    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        tools: { default: "allow", allow: [], require_approval: [], deny: [] },
        network_egress: { default: "require_approval", allow: [], require_approval: [], deny: [] },
      }),
    );

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "hook:550e8400-e29b-41d4-a716-446655440000",
      lane: "cron",
      planId: "plan-policy-1",
      requestId: "req-policy-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("Http", { url: "https://example.com/" })],
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    // First tick pauses before starting step 0 due to policy.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(0);

    const runPaused = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(runPaused?.status).toBe("paused");
    expect(runPaused?.paused_reason).toBe("policy");

    const approval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.resume_token).toBeTruthy();

    await db.run("UPDATE approvals SET status = 'approved' WHERE id = ?", [approval!.id]);
    await engine.resumeRun(approval!.resume_token!);

    await drain(engine, "w1", mockExecutor);

    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    const runDone = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(runDone?.status).toBe("succeeded");
  });

  it("pauses side-effecting steps when ToolIntent is missing for a work item run", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test intent guardrail",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-missing-1",
      requestId: "req-intent-missing-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: {
          tenant_id: scope.tenant_id,
          agent_id: scope.agent_id,
          workspace_id: scope.workspace_id,
          work_item_id: item.work_item_id,
        },
      } as unknown as never,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(0);

    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");

    const approval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    );
    expect(approval?.kind).toBe("intent");

    const decisionCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM work_decisions WHERE work_item_id = ?",
      [item.work_item_id],
    );
    expect(decisionCount?.n).toBe(1);

    const artifact = await db.get<{ kind: string; title: string; body_md: string | null }>(
      "SELECT kind, title, body_md FROM work_artifacts WHERE work_item_id = ? AND kind = 'verification_report' ORDER BY created_at DESC LIMIT 1",
      [item.work_item_id],
    );
    expect(artifact?.kind).toBe("verification_report");
    expect(artifact?.title).toMatch(/intent guardrail/i);
    expect(artifact?.body_md ?? "").toMatch(/missing toolintent/i);
  });

  it("executes after an intent approval even when ToolIntent is still missing", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test intent approval bypass",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-approved-1",
      requestId: "req-intent-approved-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: { ...scope, work_item_id: item.work_item_id },
      } as unknown as never,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    // First tick pauses for intent due to missing ToolIntent.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(0);

    const approval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    );
    expect(approval?.kind).toBe("intent");
    expect(approval?.resume_token).toBeTruthy();

    await db.run("UPDATE approvals SET status = 'approved' WHERE id = ?", [approval!.id]);
    await engine.resumeRun(approval!.resume_token!);

    // After approval, the step should execute even if ToolIntent is still missing.
    await drain(engine, "w1", mockExecutor);

    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");
  });

  it("pauses even if intent guardrail evidence writes fail (Postgres aborted tx simulation)", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test intent guardrail evidence failure",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-evidence-failure-1",
      requestId: "req-intent-evidence-failure-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: { ...scope, work_item_id: item.work_item_id },
      } as unknown as never,
    });

    await db.transaction(async (innerTx) => {
      const tx = new AbortableTx(innerTx, {
        abortOnSql: (sql) => sql.toLowerCase().includes("insert into work_artifacts"),
      });

      const run = await tx.get<unknown>(
        `SELECT r.run_id,
                r.job_id,
                r.key,
                r.lane,
                r.status,
                j.trigger_json,
                j.workspace_id,
                r.policy_snapshot_id
         FROM execution_runs r
         JOIN execution_jobs j ON j.job_id = r.job_id
         WHERE r.run_id = ?`,
        [runId],
      );
      const step = await tx.get<unknown>(
        "SELECT * FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC LIMIT 1",
        [runId],
      );
      expect(run).toBeTruthy();
      expect(step).toBeTruthy();

      const paused = await (engine as any).maybePauseForToolIntentGuardrailTx(tx, {
        run,
        step,
        actionType: "Http",
        action: undefined,
        clock: { nowMs: Date.now(), nowIso: new Date().toISOString() },
        workerId: "w1",
      });
      expect(paused?.approvalId).toBeTypeOf("number");
    });

    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");

    const approval = await db.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE run_id = ? ORDER BY id DESC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("intent");
    expect(approval?.status).toBe("pending");
  });

  it("pauses when ToolIntent intent_graph_sha256 does not match the current work item intent graph", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test intent mismatch",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-stale-1",
      requestId: "req-intent-stale-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: {
          tenant_id: scope.tenant_id,
          agent_id: scope.agent_id,
          workspace_id: scope.workspace_id,
          work_item_id: item.work_item_id,
        },
      } as unknown as never,
    });

    await workboard.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "tool_intent",
        title: "ToolIntent (stale)",
        provenance_json: {
          v: 1,
          run_id: runId,
          step_index: 0,
          goal: "Fetch example.com",
          expected_value: "Confirm connectivity",
          cost_budget: { max_duration_ms: 5_000 },
          side_effect_class: "network",
          risk_class: "low",
          expected_evidence: { http: { status: 200 } },
          intent_graph_sha256: "deadbeef",
        },
      },
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(0);

    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");

    const approval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE run_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("intent");

    const artifact = await db.get<{ kind: string; body_md: string | null }>(
      "SELECT kind, body_md FROM work_artifacts WHERE work_item_id = ? AND kind = 'verification_report' ORDER BY created_at DESC LIMIT 1",
      [item.work_item_id],
    );
    expect(artifact?.kind).toBe("verification_report");
    expect(artifact?.body_md ?? "").toMatch(/intent_graph_sha256/i);
  });

  it("executes side-effecting steps when ToolIntent matches the current work item intent graph", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test intent ok",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-ok-1",
      requestId: "req-intent-ok-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: {
          tenant_id: scope.tenant_id,
          agent_id: scope.agent_id,
          workspace_id: scope.workspace_id,
          work_item_id: item.work_item_id,
        },
      } as unknown as never,
    });

    const intentGraphSha256 = sha256HexFromString(
      stableJsonStringify({
        v: 1,
        work_item_id: item.work_item_id,
        acceptance: item.acceptance ?? null,
        state_kv: {},
        decision_ids: [],
        policy_snapshot_id: null,
      }),
    );

    await workboard.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "tool_intent",
        title: "ToolIntent (ok)",
        provenance_json: {
          v: 1,
          run_id: runId,
          step_index: 0,
          goal: "Fetch example.com",
          expected_value: "Confirm connectivity",
          cost_budget: { max_duration_ms: 5_000 },
          side_effect_class: "network",
          risk_class: "low",
          expected_evidence: { http: { status: 200 } },
          intent_graph_sha256: intentGraphSha256,
        },
      },
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    await drain(engine, "w1", mockExecutor);

    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("succeeded");

    const pendingApprovals = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM approvals WHERE run_id = ? AND status = 'pending'",
      [runId],
    );
    expect(pendingApprovals?.n).toBe(0);

    const decisionCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM work_decisions WHERE work_item_id = ?",
      [item.work_item_id],
    );
    expect(decisionCount?.n).toBe(0);
  });

  it("does not treat an approved intent approval as a policy approval", async () => {
    db = openTestSqliteDb();

    const workboard = new WorkboardDal(db);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await workboard.createItem({
      scope,
      item: {
        kind: "action",
        title: "Test policy approval kind mismatch",
        acceptance: { ok: true },
        created_from_session_key: "agent:default:main",
      },
    });

    const snapshotDal = new PolicySnapshotDal(db);
    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        tools: { default: "require_approval", allow: [], require_approval: [], deny: [] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:default:main",
      lane: "subagent",
      planId: "plan-intent-policy-bypass-1",
      requestId: "req-intent-policy-bypass-1",
      steps: [action("Http", { url: "https://example.com/" })],
      trigger: {
        kind: "manual",
        key: "agent:default:main",
        lane: "subagent",
        metadata: { ...scope, work_item_id: item.work_item_id },
      } as unknown as never,
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        throw new Error("step execution should not run before policy approval");
      }),
    };

    // First tick pauses due to missing ToolIntent (intent approval).
    expect(await engine.workerTick({ workerId: "w1", executor, runId })).toBe(true);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const intentApproval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE run_id = ? ORDER BY id ASC LIMIT 1",
      [runId],
    );
    expect(intentApproval?.kind).toBe("intent");
    expect(intentApproval?.resume_token).toBeTruthy();

    await db.run("UPDATE approvals SET status = 'approved' WHERE id = ?", [intentApproval!.id]);

    // Attach a policy snapshot after the intent pause to reproduce approval kind mismatch.
    await db.run("UPDATE execution_runs SET policy_snapshot_id = ? WHERE run_id = ?", [
      snapshot.policy_snapshot_id,
      runId,
    ]);

    const { decisions } = await workboard.listDecisions({ scope, work_item_id: item.work_item_id });
    const decisionIds = decisions
      .map((d) => d.decision_id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const intentGraphSha256 = sha256HexFromString(
      stableJsonStringify({
        v: 1,
        work_item_id: item.work_item_id,
        acceptance: item.acceptance ?? null,
        state_kv: {},
        decision_ids: decisionIds,
        policy_snapshot_id: snapshot.policy_snapshot_id,
      }),
    );

    await workboard.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "tool_intent",
        title: "ToolIntent (ok)",
        provenance_json: {
          v: 1,
          run_id: runId,
          step_index: 0,
          goal: "Fetch example.com",
          expected_value: "Confirm connectivity",
          cost_budget: { max_duration_ms: 5_000 },
          side_effect_class: "network",
          risk_class: "low",
          expected_evidence: { http: { status: 200 } },
          intent_graph_sha256: intentGraphSha256,
        },
      },
    });

    await engine.resumeRun(intentApproval!.resume_token!);

    // Next tick should still pause for policy approval (intent approval must not satisfy policy).
    expect(await engine.workerTick({ workerId: "w1", executor, runId })).toBe(true);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("policy");

    const policyApproval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE run_id = ? ORDER BY id DESC LIMIT 1",
      [runId],
    );
    expect(policyApproval?.kind).toBe("policy");
  });

  it("fails the run when policy denies a step (cancels remaining steps + releases leases)", async () => {
    db = openTestSqliteDb();

    const snapshotDal = new PolicySnapshotDal(db);
    const snapshot = await snapshotDal.getOrCreate(
      PolicyBundle.parse({
        v: 1,
        tools: { default: "allow", allow: [], require_approval: [], deny: ["tool.http.fetch"] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-policy-deny-1",
      requestId: "req-policy-deny-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [
        action("Http", { url: "https://example.com/" }),
        action("CLI", { cmd: "echo", args: ["hi"] }),
      ],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    expect(await engine.workerTick({ workerId: "w1", executor })).toBe(true);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("failed");

    const job = await db.get<{ status: string }>("SELECT status FROM execution_jobs LIMIT 1");
    expect(job?.status).toBe("failed");

    const stepRows = await db.all<{ step_index: number; status: string }>(
      "SELECT step_index, status FROM execution_steps ORDER BY step_index ASC",
    );
    expect(stepRows.map((row) => row.status)).toEqual(["failed", "cancelled"]);

    const attempt = await db.get<{ status: string; policy_snapshot_id: string | null }>(
      "SELECT status, policy_snapshot_id FROM execution_attempts ORDER BY attempt DESC LIMIT 1",
    );
    expect(attempt?.status).toBe("failed");
    expect(attempt?.policy_snapshot_id).toBe(snapshot.policy_snapshot_id);

    const laneLeases = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM lane_leases");
    expect(laneLeases?.n).toBe(0);
    const workspaceLeases = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workspace_leases",
    );
    expect(workspaceLeases?.n).toBe(0);

    expect(await engine.workerTick({ workerId: "w1", executor })).toBe(false);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );
  });

  it("fails closed when a stored policy snapshot is malformed (override cannot auto-allow)", async () => {
    db = openTestSqliteDb();

    const originalPolicyEnabled = process.env["TYRUM_POLICY_ENABLED"];
    process.env["TYRUM_POLICY_ENABLED"] = "1";

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-invalid-snapshot-"));
    try {
      const snapshotDal = new PolicySnapshotDal(db);
      const overrideDal = new PolicyOverrideDal(db);
      const policyService = new PolicyService({ home, snapshotDal, overrideDal });

      const invalidSnapshotId = "11111111-1111-1111-8111-111111111111";
      await db.run(
        `INSERT INTO policy_snapshots (policy_snapshot_id, sha256, bundle_json)
         VALUES (?, ?, ?)`,
        [invalidSnapshotId, "invalid", "{not-json"],
      );

      await overrideDal.create({
        agentId: "default",
        workspaceId: "default",
        toolId: "tool.exec",
        pattern: "echo hi",
        createdFromPolicySnapshotId: invalidSnapshotId,
      });

      const engine = new ExecutionEngine({ db, policyService });
      await engine.enqueuePlan({
        key: "agent:default:telegram-1:group:thread-1",
        lane: "main",
        planId: "plan-policy-invalid-snapshot-1",
        requestId: "req-policy-invalid-snapshot-1",
        policySnapshotId: invalidSnapshotId,
        steps: [action("CLI", { cmd: "echo", args: ["hi"] })],
      });

      const executor: StepExecutor = {
        execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
      };

      expect(await engine.workerTick({ workerId: "w1", executor })).toBe(true);
      expect(
        (executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      ).toBe(0);

      const runPaused = await db.get<{ status: string; paused_reason: string | null }>(
        "SELECT status, paused_reason FROM execution_runs LIMIT 1",
      );
      expect(runPaused?.status).toBe("paused");
      expect(runPaused?.paused_reason).toBe("policy");
    } finally {
      if (originalPolicyEnabled === undefined) {
        delete process.env["TYRUM_POLICY_ENABLED"];
      } else {
        process.env["TYRUM_POLICY_ENABLED"] = originalPolicyEnabled;
      }

      await rm(home, { recursive: true, force: true });
    }
  });

  it("records attempt finished_at after started_at", async () => {
    db = openTestSqliteDb();

    let calls = 0;
    const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0);
    const engine = new ExecutionEngine({
      db,
      clock: () => {
        calls += 1;
        const nowMs = baseMs + calls * 1000;
        return { nowMs, nowIso: new Date(nowMs).toISOString() };
      },
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-finished-at-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const row = await db.get<{ started_at: string; finished_at: string | null }>(
      "SELECT started_at, finished_at FROM execution_attempts LIMIT 1",
    );

    expect(row!.finished_at).not.toBeNull();
    expect(row!.finished_at).not.toBe(row!.started_at);
    expect(new Date(row!.finished_at!).getTime()).toBeGreaterThan(
      new Date(row!.started_at).getTime(),
    );
  });

  it("persists artifact refs returned by the step executor on attempts", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-artifacts-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      created_at: new Date().toISOString(),
      labels: [],
    } as const;

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true }, artifacts: [artifactRef] };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const row = await db.get<{ artifacts_json: string }>(
      "SELECT artifacts_json FROM execution_attempts LIMIT 1",
    );
    const artifacts = JSON.parse(row!.artifacts_json) as Array<{ uri: string; kind: string }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.uri).toBe(artifactRef.uri);
    expect(artifacts[0]!.kind).toBe(artifactRef.kind);

    const attempt = await db.get<{ attempt_id: string; step_id: string }>(
      "SELECT attempt_id, step_id FROM execution_attempts LIMIT 1",
    );
    const metadata = await db.get<{
      workspace_id: string;
      agent_id: string | null;
      run_id: string;
      step_id: string;
      attempt_id: string;
      kind: string;
    }>(
      "SELECT workspace_id, agent_id, run_id, step_id, attempt_id, kind FROM execution_artifacts WHERE artifact_id = ?",
      [artifactRef.artifact_id],
    );
    expect(metadata?.workspace_id).toBe("default");
    expect(metadata?.agent_id).toBe("agent-1");
    expect(metadata?.run_id).toBe(runId);
    expect(metadata?.step_id).toBe(attempt!.step_id);
    expect(metadata?.attempt_id).toBe(attempt!.attempt_id);
    expect(metadata?.kind).toBe(artifactRef.kind);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");
    expect(types).toContain("artifact.created");
    expect(types).toContain("artifact.attached");
  });

  it("only emits artifact.created when the artifact is first inserted", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-artifacts-created-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Research")],
    });

    const artifactRef = {
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      created_at: new Date().toISOString(),
      labels: [],
    } as const;

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true }, artifacts: [artifactRef] };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const types = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((value): value is string => typeof value === "string");

    expect(types.filter((type) => type === "artifact.created")).toHaveLength(1);
    expect(types.filter((type) => type === "artifact.attached")).toHaveLength(2);
  });

  it("redacts registered secrets from persisted attempt results", async () => {
    db = openTestSqliteDb();

    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-XYZ"]);

    const engine = new ExecutionEngine({ db, redactionEngine: redaction });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-redact-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { token: "secret-XYZ" },
        };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const row = await db.get<{ result_json: string }>(
      "SELECT result_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      [runId],
    );
    expect(row!.result_json).toContain("[REDACTED]");
    expect(row!.result_json).not.toContain("secret-XYZ");
  });

  it("persists per-attempt cost attribution when provided", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-cost-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          cost: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const row = await db.get<{ cost_json: string | null }>(
      "SELECT cost_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      [runId],
    );
    expect(row!.cost_json).toBeTruthy();
    const cost = JSON.parse(row!.cost_json!) as { total_tokens?: number; duration_ms?: number };
    expect(cost.total_tokens).toBe(30);
    expect(typeof cost.duration_ms).toBe("number");
  });

  it("emits run.cancelled when a run is cancelled", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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

  it("persists policy decisions (reasons + snapshot + applied override ids) on attempts", async () => {
    db = openTestSqliteDb();

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });

    const snapshot = await snapshotDal.getOrCreate(defaultPolicyBundle());
    const override = await overrideDal.create({
      agentId: "agent-1",
      workspaceId: "default",
      toolId: "tool.exec",
      pattern: "echo hi",
      createdFromPolicySnapshotId: snapshot.policy_snapshot_id,
    });

    const engine = new ExecutionEngine({ db, policyService });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-policy-attempt-1",
      requestId: "req-policy-attempt-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("CLI", { cmd: "echo", args: ["hi"] })],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    await drain(engine, "w1", executor);

    const row = await db.get<{
      policy_snapshot_id?: string | null;
      policy_decision_json?: string | null;
      policy_applied_override_ids_json?: string | null;
    }>("SELECT * FROM execution_attempts LIMIT 1");

    expect(row?.policy_snapshot_id).toBe(snapshot.policy_snapshot_id);

    expect(row?.policy_decision_json).toBeTruthy();
    const policyDecision = JSON.parse(row!.policy_decision_json!) as {
      decision?: unknown;
      rules?: unknown;
    };
    expect(policyDecision.decision).toBe("allow");
    expect(Array.isArray(policyDecision.rules)).toBe(true);

    expect(row?.policy_applied_override_ids_json).toBeTruthy();
    const applied = JSON.parse(row!.policy_applied_override_ids_json!) as unknown;
    expect(Array.isArray(applied)).toBe(true);
    expect(applied).toContain(override.policy_override_id);

    await rm(home, { recursive: true, force: true });
  });

  it("pauses workflow steps that resolve secret handles until policy approval", async () => {
    db = openTestSqliteDb();

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });

    const snapshot = await snapshotDal.getOrCreate(defaultPolicyBundle());

    const engine = new ExecutionEngine({ db, policyService });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-secret-policy-1",
      requestId: "req-secret-policy-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("CLI", { cmd: "echo", args: ["secret:h1"] })],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    expect(await engine.workerTick({ workerId: "w1", executor })).toBe(true);
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      0,
    );

    const paused = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(paused?.status).toBe("paused");
    expect(paused?.paused_reason).toBe("policy");

    const approval = await db.get<{ id: number; kind: string; resume_token: string | null }>(
      "SELECT id, kind, resume_token FROM approvals WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.resume_token).toBeTruthy();

    const approvalDal = new ApprovalDal(db);
    await approvalDal.respond(approval!.id, true);
    await engine.resumeRun(approval!.resume_token!);

    await drain(engine, "w1", executor);

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      1,
    );

    await rm(home, { recursive: true, force: true });
  });

  it("treats approval id 0 as a valid approved policy gate", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    await db.run(
      `INSERT INTO approvals (id, plan_id, step_index, prompt, status, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [0, "plan-0", 0, "ok", "approved", "policy"],
    );

    const ok = await (
      engine as unknown as {
        isApprovedPolicyGateTx: (tx: unknown, approvalId: number) => Promise<boolean>;
      }
    ).isApprovedPolicyGateTx(db, 0);
    expect(ok).toBe(true);
  });

  it("evaluates secret policy using provider:scope when possible", async () => {
    db = openTestSqliteDb();

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });

    const bundle = PolicyBundle.parse({
      v: 1,
      tools: {
        default: "deny",
        allow: ["tool.exec"],
        require_approval: [],
        deny: [],
      },
      secrets: {
        default: "deny",
        allow: ["env:MY_API_KEY"],
        require_approval: [],
        deny: [],
      },
    });
    const snapshot = await snapshotDal.getOrCreate(bundle);

    const secretProvider: SecretProvider = {
      resolve: vi.fn(async () => null),
      store: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      revoke: vi.fn(async () => false),
      list: vi.fn(async () => [
        {
          handle_id: "h1",
          provider: "env",
          scope: "MY_API_KEY",
          created_at: new Date().toISOString(),
        },
      ]),
    };

    const engine = new ExecutionEngine({ db, policyService, secretProvider });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-secret-policy-2",
      requestId: "req-secret-policy-2",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("CLI", { cmd: "echo", args: ["secret:h1"] })],
    });

    const executor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };

    await drain(engine, "w1", executor);

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      1,
    );
    expect(secretProvider.list).toHaveBeenCalled();

    const approvalCount = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals");
    expect(approvalCount?.n).toBe(0);

    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");

    await rm(home, { recursive: true, force: true });
  });

  it("persists policy decisions on attempts for non-tool actions", async () => {
    db = openTestSqliteDb();

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-action-"));
    try {
      const snapshotDal = new PolicySnapshotDal(db);
      const overrideDal = new PolicyOverrideDal(db);
      const policyService = new PolicyService({ home, snapshotDal, overrideDal });

      const snapshot = await snapshotDal.getOrCreate(
        PolicyBundle.parse({
          v: 1,
          tools: { default: "allow", allow: [], require_approval: [], deny: [] },
          network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
        }),
      );

      const engine = new ExecutionEngine({ db, policyService });
      await engine.enqueuePlan({
        key: "agent:agent-1:telegram-1:group:thread-1",
        lane: "main",
        planId: "plan-policy-action-1",
        requestId: "req-policy-action-1",
        policySnapshotId: snapshot.policy_snapshot_id,
        steps: [action("Research")],
      });

      const executor: StepExecutor = {
        execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
      };

      await drain(engine, "w1", executor);
      expect(
        (executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
      ).toBe(1);

      const row = await db.get<{
        policy_snapshot_id?: string | null;
        policy_decision_json?: string | null;
        policy_applied_override_ids_json?: string | null;
      }>("SELECT * FROM execution_attempts LIMIT 1");

      expect(row?.policy_snapshot_id).toBe(snapshot.policy_snapshot_id);
      expect(row?.policy_decision_json).toBeTruthy();
      const policyDecision = JSON.parse(row!.policy_decision_json!) as {
        decision?: unknown;
        rules?: unknown;
      };
      expect(policyDecision.decision).toBe("allow");
      expect(Array.isArray(policyDecision.rules)).toBe(true);

      expect(row?.policy_applied_override_ids_json).toBeTruthy();
      const applied = JSON.parse(row!.policy_applied_override_ids_json!) as unknown;
      expect(applied).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("retries a failed step until it succeeds (within max_attempts)", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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

    // First tick runs step 0 and fails; engine pauses for a retry approval.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(1);

    const approval = await db.get<{ kind: string; resume_token: string | null }>(
      "SELECT kind, resume_token FROM approvals WHERE run_id = ? ORDER BY id DESC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("retry");
    expect(approval?.resume_token).toBeTruthy();

    await engine.resumeRun(approval!.resume_token!);

    await drain(engine, "w1", mockExecutor);

    expect(
      (mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(2);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("succeeded");
  });

  it("pauses a run when postcondition is missing evidence and issues a resume token", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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
      execute: vi.fn(async (): Promise<StepResult> => {
        // Success but missing evidence -> unverifiable -> pause
        return { success: true, result: { ok: true } };
      }),
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
      "SELECT token, run_id, revoked_at FROM resume_tokens WHERE run_id = ?",
      [runId],
    );
    expect(tokenRow!.run_id).toBe(runId);
    expect(tokenRow!.revoked_at).toBeNull();

    const approvalRow = await db.get<{
      id: number;
      kind: string;
      status: string;
      run_id: string | null;
      resume_token: string | null;
    }>("SELECT id, kind, status, run_id, resume_token FROM approvals WHERE run_id = ?", [runId]);
    expect(approvalRow).toBeTruthy();
    expect(approvalRow!.kind).toBe("takeover");
    expect(approvalRow!.status).toBe("pending");
    expect(approvalRow!.run_id).toBe(runId);
    expect(approvalRow!.resume_token).toBe(tokenRow!.token);

    const stepApproval = await db.get<{ approval_id: number | null }>(
      "SELECT approval_id FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(stepApproval!.approval_id).toBe(approvalRow!.id);
  });

  it("resumes a paused run using a resume token", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", pausingExecutor);

    const token = (await db.get<{ token: string }>(
      "SELECT token FROM resume_tokens WHERE run_id = ?",
      [runId],
    ))!.token;

    const resumed = await engine.resumeRun(token);
    expect(resumed).toBe(runId);

    const resumingExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true }, evidence: { http: { status: 200 } } };
      }),
    };

    await drain(engine, "w1", resumingExecutor);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("succeeded");

    const tokenRow = await db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [token],
    );
    expect(tokenRow!.revoked_at).not.toBeNull();
  });

  it("short-circuits execution when an idempotency record already succeeded", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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
      `INSERT INTO idempotency_records (scope_key, kind, idempotency_key, status, result_json)
       VALUES (?, 'step', ?, 'succeeded', ?)`,
      [stepRow!.step_id, stepRow!.idempotency_key, JSON.stringify({ cached: true })],
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { shouldNotRun: true } };
      }),
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
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const record = await db.get<{ status: string; result_json: string | null }>(
      `SELECT status, result_json
         FROM idempotency_records
         WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
      [stepRow!.step_id, stepRow!.idempotency_key],
    );
    expect(record?.status).toBe("succeeded");
    expect(JSON.parse(record?.result_json ?? "{}")).toEqual({ ok: true });
  });

  it("takes over a stale running attempt by cancelling it and re-queuing the step", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
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

    // Simulate a prior worker that crashed mid-attempt.
    await db.run("UPDATE execution_steps SET status = 'running' WHERE step_id = ?", [
      step!.step_id,
    ]);
    await db.run(
      `INSERT INTO execution_attempts (
         attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms
       ) VALUES (?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
      ["attempt-1", step!.step_id, new Date().toISOString(), Date.now() - 1],
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const attempts = await db.all<{ attempt: number; status: string }>(
      "SELECT attempt, status FROM execution_attempts WHERE step_id = ? ORDER BY attempt ASC",
      [step!.step_id],
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

      const { runId: run1 } = await engineA.enqueuePlan({
        key: "agent:default:ui:thread-1",
        lane: "main",
        planId: "plan-concurrency-1",
        requestId: "req-1",
        steps: [action("CLI")],
      });
      const { runId: run2 } = await engineA.enqueuePlan({
        key: "agent:default:ui:thread-2",
        lane: "main",
        planId: "plan-concurrency-2",
        requestId: "req-2",
        steps: [action("CLI")],
      });

      // Use distinct workspaces so the workspace lease doesn't serialize the test runs.
      await dbA.run(
        "UPDATE execution_jobs SET workspace_id = ? WHERE job_id = (SELECT job_id FROM execution_runs WHERE run_id = ?)",
        ["ws-1", run1],
      );
      await dbA.run(
        "UPDATE execution_jobs SET workspace_id = ? WHERE job_id = (SELECT job_id FROM execution_runs WHERE run_id = ?)",
        ["ws-2", run2],
      );

      let unblock: ((value: StepResult) => void) | undefined;
      const blocked = new Promise<StepResult>((resolve) => {
        unblock = resolve;
      });
      const blockingExecutor: StepExecutor = {
        execute: vi.fn(async () => {
          return await blocked;
        }),
      };

      const fastExecutor: StepExecutor = {
        execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
      };

      const tick1 = engineA.workerTick({ workerId: "w1", executor: blockingExecutor });

      // Wait for the first attempt to be claimed and marked running.
      for (let i = 0; i < 50; i += 1) {
        const running = await dbB.get<{ n: number }>(
          `SELECT COUNT(*) AS n
           FROM execution_attempts a
           JOIN execution_steps s ON s.step_id = a.step_id
           WHERE s.run_id = ? AND a.status = 'running'`,
          [run1],
        );
        if ((running?.n ?? 0) === 1) break;
        await delay(10);
      }

      const slotInUse = await dbB.get<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM concurrency_slots
         WHERE scope = 'global' AND scope_id = 'global' AND attempt_id IS NOT NULL`,
      );
      expect(slotInUse?.n).toBe(1);

      // Second worker cannot claim a new attempt while the global slot is held.
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
});
