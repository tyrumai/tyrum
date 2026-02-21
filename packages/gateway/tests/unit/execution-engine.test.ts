import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function action(type: ActionPrimitive["type"], args?: Record<string, unknown>): ActionPrimitive {
  return {
    type,
    args: args ?? {},
  };
}

async function drain(engine: ExecutionEngine, workerId: string, executor: StepExecutor): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const worked = await engine.workerTick({ workerId, executor });
    if (!worked) return;
  }
  throw new Error("worker did not become idle after 25 ticks");
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
      key: "agent:agent-1:telegram:default:group:thread-1",
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

  it("worker executes a 2-step plan and completes the run", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs LIMIT 1",
    );
    expect(run!.status).toBe("succeeded");

    const job = await db.get<{ status: string }>(
      "SELECT status FROM execution_jobs LIMIT 1",
    );
    expect(job!.status).toBe("completed");
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
      key: "agent:agent-1:telegram:default:group:thread-1",
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
    expect(new Date(row!.finished_at!).getTime()).toBeGreaterThan(new Date(row!.started_at).getTime());
  });

  it("persists artifact refs returned by the step executor on attempts", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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

    const meta = await db.get<{
      artifact_id: string;
      agent_id: string;
      workspace_id: string;
      run_id: string | null;
      attempt_id: string | null;
      kind: string;
    }>("SELECT artifact_id, agent_id, workspace_id, run_id, attempt_id, kind FROM artifacts WHERE artifact_id = ?", [
      artifactRef.artifact_id,
    ]);
    expect(meta).toBeDefined();
    expect(meta!.artifact_id).toBe(artifactRef.artifact_id);
    expect(meta!.agent_id).toBe("agent-1");
    expect(meta!.workspace_id).toBe("default");
    expect(meta!.run_id).toBe(runId);
    expect(meta!.attempt_id).not.toBeNull();
    expect(meta!.kind).toBe(artifactRef.kind);
  });

  it("redacts registered secrets from persisted attempt results", async () => {
    db = openTestSqliteDb();

    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-XYZ"]);

    const engine = new ExecutionEngine({ db, redactionEngine: redaction });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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
      key: "agent:agent-1:telegram:default:group:thread-1",
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

  it("retries a failed step until it succeeds (within max_attempts)", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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

  it("pauses a run when postcondition is missing evidence and issues a resume token", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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
    expect(run!.paused_reason).toBe("manual");

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
  });

  it("resumes a paused run using a resume token", async () => {
    db = openTestSqliteDb();

    const engine = new ExecutionEngine({ db });
    const { runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
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

    const token = (
      await db.get<{ token: string }>("SELECT token FROM resume_tokens WHERE run_id = ?", [runId])
    )!.token;

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
      key: "agent:agent-1:telegram:default:group:thread-1",
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
      key: "agent:agent-1:telegram:default:group:thread-1",
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
      key: "agent:agent-1:telegram:default:group:thread-1",
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
    await db.run("UPDATE execution_steps SET status = 'running' WHERE step_id = ?", [step!.step_id]);
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
});
