import { expect, it, vi } from "vitest";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { action, enqueuePlan, drain, mockCallCount } from "./execution-engine.test-support.js";

export function registerEnqueueLifecycleTests(fixture: { db: () => SqliteDb }): void {
  it("creates normalized execution records for a plan", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { jobId, runId } = await enqueuePlan(engine, {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-run-events-1",
      requestId: "req-run-events-1",
      steps: [action("Research")],
    });
    await db.run("DELETE FROM outbox");
    const typesToEmit = [
      "run.queued",
      "run.started",
      "run.resumed",
      "run.completed",
      "run.failed",
    ] as const;
    await db.transaction(async (tx) => {
      const engineAny = engine as unknown as {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
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
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
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
    const db = fixture.db();
    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({ db, clock: () => ({ nowMs: 0, nowIso }) });
    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "other-worker", 60_000],
    );
    await enqueuePlan(engine, {
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
    expect(mockCallCount(executor)).toBe(1);
    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");
  });

  it("blocks workspace-mutating tool steps while a workspace lease is held", async () => {
    const db = fixture.db();
    const nowIso = new Date(0).toISOString();
    const engine = new ExecutionEngine({ db, clock: () => ({ nowMs: 0, nowIso }) });
    await db.run(
      `INSERT INTO workspace_leases (tenant_id, workspace_id, lease_owner, lease_expires_at_ms) VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID, "other-worker", 60_000],
    );
    await enqueuePlan(engine, {
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
    expect(mockCallCount(executor)).toBe(0);
    const step = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps ORDER BY step_index ASC LIMIT 1",
    );
    expect(step?.status).toBe("queued");
  });

  it("emits run.failed when a run exhausts retry attempts", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
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

  it("worker executes a 2-step plan and completes the run", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-test-2",
      requestId: "test-req-1",
      steps: [action("Research"), action("Message", { body: "done" })],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    await drain(engine, "w1", mockExecutor);
    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run!.status).toBe("succeeded");
    const job = await db.get<{ status: string }>("SELECT status FROM execution_jobs LIMIT 1");
    expect(job!.status).toBe("completed");
  });

  it("accepts workspace ids via the legacy enqueuePlan workspaceId alias", async () => {
    const db = fixture.db();
    const { IdentityScopeDal } = await import("../../src/modules/identity/scope.js");
    const scopeIds = await new IdentityScopeDal(db).resolveScopeIds({
      agentKey: "agent-legacy-workspace",
      workspaceKey: "work-legacy",
    });
    const engine = new ExecutionEngine({ db });
    await enqueuePlan(engine, {
      key: "agent:agent-legacy-workspace:main",
      lane: "main",
      planId: "plan-legacy-workspace-id",
      requestId: "req-legacy-workspace-id",
      workspaceId: scopeIds.workspaceId,
      steps: [action("CLI")],
    });
    const job = await db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM execution_jobs ORDER BY created_at DESC, job_id DESC LIMIT 1",
    );
    expect(job?.workspace_id).toBe(scopeIds.workspaceId);
    const duplicatedWorkspace = await db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspaces WHERE tenant_id = ? AND workspace_key = ? LIMIT 1",
      [DEFAULT_TENANT_ID, scopeIds.workspaceId],
    );
    expect(duplicatedWorkspace).toBeUndefined();
  });
}
