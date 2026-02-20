import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionPrimitive } from "@tyrum/schemas";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

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
  let db: ReturnType<typeof createDatabase> | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("creates normalized execution records for a plan", () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { jobId, runId } = engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-test-1",
      requestId: "test-req-1",
      steps: [action("Research"), action("Message", { body: "hi" })],
    });

    const jobCount = db
      .prepare("SELECT COUNT(*) AS n FROM execution_jobs WHERE job_id = ?")
      .get(jobId) as { n: number };
    expect(jobCount.n).toBe(1);

    const runCount = db
      .prepare("SELECT COUNT(*) AS n FROM execution_runs WHERE run_id = ?")
      .get(runId) as { n: number };
    expect(runCount.n).toBe(1);

    const stepCount = db
      .prepare("SELECT COUNT(*) AS n FROM execution_steps WHERE run_id = ?")
      .get(runId) as { n: number };
    expect(stepCount.n).toBe(2);
  });

  it("worker executes a 2-step plan and completes the run", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    engine.enqueuePlan({
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

    const run = db
      .prepare("SELECT status FROM execution_runs LIMIT 1")
      .get() as { status: string };
    expect(run.status).toBe("succeeded");

    const job = db
      .prepare("SELECT status FROM execution_jobs LIMIT 1")
      .get() as { status: string };
    expect(job.status).toBe("completed");
  });

  it("persists artifact refs returned by the step executor on attempts", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    engine.enqueuePlan({
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

    const row = db
      .prepare("SELECT artifacts_json FROM execution_attempts LIMIT 1")
      .get() as { artifacts_json: string };
    const artifacts = JSON.parse(row.artifacts_json) as Array<{ uri: string; kind: string }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.uri).toBe(artifactRef.uri);
    expect(artifacts[0]!.kind).toBe(artifactRef.kind);
  });

  it("redacts registered secrets from persisted attempt results", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-XYZ"]);

    const engine = new ExecutionEngine({ db, redactionEngine: redaction });
    const { runId } = engine.enqueuePlan({
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

    const row = db
      .prepare(
        "SELECT result_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      )
      .get(runId) as { result_json: string };
    expect(row.result_json).toContain("[REDACTED]");
    expect(row.result_json).not.toContain("secret-XYZ");
  });

  it("persists per-attempt cost attribution when provided", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
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

    const row = db
      .prepare(
        "SELECT cost_json FROM execution_attempts WHERE step_id IN (SELECT step_id FROM execution_steps WHERE run_id = ?) LIMIT 1",
      )
      .get(runId) as { cost_json: string | null };
    expect(row.cost_json).toBeTruthy();
    const cost = JSON.parse(row.cost_json!) as { total_tokens?: number; duration_ms?: number };
    expect(cost.total_tokens).toBe(30);
    expect(typeof cost.duration_ms).toBe("number");
  });

  it("retries a failed step until it succeeds (within max_attempts)", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-retry-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    db.prepare("UPDATE execution_steps SET max_attempts = 2 WHERE run_id = ?").run(runId);

    let callCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        callCount += 1;
        if (callCount === 1) return { success: false, error: "transient" };
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const attemptRows = db
      .prepare("SELECT attempt, status FROM execution_attempts ORDER BY attempt ASC")
      .all() as Array<{ attempt: number; status: string }>;
    expect(attemptRows.map((r) => r.status)).toEqual(["failed", "succeeded"]);

    const step = db
      .prepare("SELECT status FROM execution_steps WHERE run_id = ?")
      .get(runId) as { status: string };
    expect(step.status).toBe("succeeded");
  });

  it("pauses a run when postcondition is missing evidence and issues a resume token", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
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

    const run = db
      .prepare("SELECT status, paused_reason FROM execution_runs WHERE run_id = ?")
      .get(runId) as { status: string; paused_reason: string | null };
    expect(run.status).toBe("paused");
    expect(run.paused_reason).toBe("manual");

    const step = db
      .prepare("SELECT status FROM execution_steps WHERE run_id = ?")
      .get(runId) as { status: string };
    expect(step.status).toBe("paused");

    const tokenRow = db
      .prepare("SELECT token, run_id, revoked_at FROM resume_tokens WHERE run_id = ?")
      .get(runId) as { token: string; run_id: string; revoked_at: string | null };
    expect(tokenRow.run_id).toBe(runId);
    expect(tokenRow.revoked_at).toBeNull();
  });

  it("resumes a paused run using a resume token", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
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

    const token = (db
      .prepare("SELECT token FROM resume_tokens WHERE run_id = ?")
      .get(runId) as { token: string }).token;

    const resumed = engine.resumeRun(token);
    expect(resumed).toBe(runId);

    const resumingExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true }, evidence: { http: { status: 200 } } };
      }),
    };

    await drain(engine, "w1", resumingExecutor);

    const run = db
      .prepare("SELECT status FROM execution_runs WHERE run_id = ?")
      .get(runId) as { status: string };
    expect(run.status).toBe("succeeded");

    const tokenRow = db
      .prepare("SELECT revoked_at FROM resume_tokens WHERE token = ?")
      .get(token) as { revoked_at: string | null };
    expect(tokenRow.revoked_at).not.toBeNull();
  });

  it("short-circuits execution when an idempotency record already succeeded", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-idem-1",
      requestId: "test-req-1",
      steps: [{ ...action("Research"), idempotency_key: "idem-1" }],
    });

    const stepRow = db
      .prepare("SELECT step_id, idempotency_key FROM execution_steps WHERE run_id = ?")
      .get(runId) as { step_id: string; idempotency_key: string };

    db.prepare(
      `INSERT INTO idempotency_records (scope_key, kind, idempotency_key, status, result_json)
       VALUES (?, 'step', ?, 'succeeded', ?)`,
    ).run(stepRow.step_id, stepRow.idempotency_key, JSON.stringify({ cached: true }));

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { shouldNotRun: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    expect(mockExecutor.execute).not.toHaveBeenCalled();

    const attempt = db
      .prepare("SELECT status, result_json FROM execution_attempts WHERE step_id = ?")
      .get(stepRow.step_id) as { status: string; result_json: string | null };
    expect(attempt.status).toBe("succeeded");
    expect(JSON.parse(attempt.result_json ?? "{}")).toEqual({ cached: true });
  });

  it("writes idempotency outcomes for succeeded steps", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-idem-write-1",
      requestId: "test-req-1",
      steps: [{ ...action("Research"), idempotency_key: "idem-write-1" }],
    });

    const stepRow = db
      .prepare("SELECT step_id, idempotency_key FROM execution_steps WHERE run_id = ?")
      .get(runId) as { step_id: string; idempotency_key: string };

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const record = db
      .prepare(
        `SELECT status, result_json
         FROM idempotency_records
         WHERE scope_key = ? AND kind = 'step' AND idempotency_key = ?`,
      )
      .get(stepRow.step_id, stepRow.idempotency_key) as
      | { status: string; result_json: string | null }
      | undefined;
    expect(record?.status).toBe("succeeded");
    expect(JSON.parse(record?.result_json ?? "{}")).toEqual({ ok: true });
  });

  it("takes over a stale running attempt by cancelling it and re-queuing the step", async () => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);

    const engine = new ExecutionEngine({ db });
    const { runId } = engine.enqueuePlan({
      key: "agent:agent-1:telegram-1:group:thread-1",
      lane: "main",
      planId: "plan-takeover-1",
      requestId: "test-req-1",
      steps: [action("Research")],
    });

    const step = db
      .prepare("SELECT step_id FROM execution_steps WHERE run_id = ?")
      .get(runId) as { step_id: string };

    // Simulate a prior worker that crashed mid-attempt.
    db.prepare("UPDATE execution_steps SET status = 'running' WHERE step_id = ?").run(step.step_id);
    db.prepare(
      `INSERT INTO execution_attempts (
         attempt_id, step_id, attempt, status, started_at, artifacts_json, lease_owner, lease_expires_at_ms
       ) VALUES (?, ?, 1, 'running', ?, '[]', 'dead-worker', ?)`,
    ).run("attempt-1", step.step_id, new Date().toISOString(), Date.now() - 1);

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const attempts = db
      .prepare("SELECT attempt, status FROM execution_attempts WHERE step_id = ? ORDER BY attempt ASC")
      .all(step.step_id) as Array<{ attempt: number; status: string }>;
    expect(attempts.map((a) => a.status)).toEqual(["cancelled", "succeeded"]);
  });
});

