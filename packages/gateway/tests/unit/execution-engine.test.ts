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
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { defaultPolicyBundle } from "../../src/modules/policy/bundle-loader.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs LIMIT 1",
    );
    expect(run!.status).toBe("succeeded");

    const job = await db.get<{ status: string }>(
      "SELECT status FROM execution_jobs LIMIT 1",
    );
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
    expect((mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    // Second tick pauses before starting step 1 due to the run budget.
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect((mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

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

    const runResumed = await db.get<{ status: string; budget_overridden_at: string | null }>(
      "SELECT status, budget_overridden_at FROM execution_runs LIMIT 1",
    );
    expect(runResumed?.status).toBe("queued");
    expect(runResumed?.budget_overridden_at).toBeTruthy();

    await drain(engine, "w1", mockExecutor);

    const runDone = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs LIMIT 1",
    );
    expect(runDone?.status).toBe("succeeded");
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
    expect(new Date(row!.finished_at!).getTime()).toBeGreaterThan(new Date(row!.started_at).getTime());
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
    const policyDecision = JSON.parse(row!.policy_decision_json!) as { decision?: unknown; rules?: unknown };
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
    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);

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

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    await rm(home, { recursive: true, force: true });
  });

  it("evaluates secret policy using provider:scope when possible", async () => {
    db = openTestSqliteDb();

    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });

    const bundle = PolicyBundle.parse({
      v: 1,
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

    expect((executor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    const approvalCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM approvals",
    );
    expect(approvalCount?.n).toBe(0);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs LIMIT 1",
    );
    expect(run?.status).toBe("succeeded");

    await rm(home, { recursive: true, force: true });
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
    expect((mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    const approval = await db.get<{ kind: string; resume_token: string | null }>(
      "SELECT kind, resume_token FROM approvals WHERE run_id = ? ORDER BY id DESC LIMIT 1",
      [runId],
    );
    expect(approval?.kind).toBe("retry");
    expect(approval?.resume_token).toBeTruthy();

    await engine.resumeRun(approval!.resume_token!);

    await drain(engine, "w1", mockExecutor);

    expect((mockExecutor.execute as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);

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
