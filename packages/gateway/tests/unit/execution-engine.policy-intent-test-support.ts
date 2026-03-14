import { expect, it, vi } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { defaultPolicyBundle } from "../../src/modules/policy/bundle-loader.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { action, enqueuePlan, drain, mockCallCount } from "./execution-engine.test-support.js";

function registerPolicyApprovalTests(fixture: { db: () => SqliteDb }): void {
  it("pauses when policy requires approval for a step and resumes after approval", async () => {
    const db = fixture.db();
    const snapshotDal = new PolicySnapshotDal(db);
    const snapshot = await snapshotDal.getOrCreate(
      DEFAULT_TENANT_ID,
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
    await enqueuePlan(engine, {
      key: "hook:550e8400-e29b-41d4-a716-446655440000",
      lane: "cron",
      planId: "plan-policy-1",
      requestId: "req-policy-1",
      policySnapshotId: snapshot.policy_snapshot_id,
      steps: [action("Http", { url: "https://example.com/" })],
    });
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => ({ success: true, result: { ok: true } })),
    };
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(0);
    const runPaused = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(runPaused?.status).toBe("paused");
    expect(runPaused?.paused_reason).toBe("policy");
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND status = 'queued' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.resume_token).toBeTruthy();
    const approvalDal = new ApprovalDal(db);
    const pendingApproval = await approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval!.approval_id,
    });
    expect(pendingApproval?.context).toMatchObject({
      source: "execution-engine",
      tool_id: "webfetch",
      tool_match_target: "https://example.com/",
      decision: "require_approval",
      policy: {
        policy_snapshot_id: snapshot.policy_snapshot_id,
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "webfetch",
            pattern: "https://example.com/",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      },
    });
    await approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval!.approval_id,
      decision: "approved",
    });
    await engine.resumeRun(approval!.resume_token!);
    await drain(engine, "w1", mockExecutor);
    expect(mockCallCount(mockExecutor)).toBe(1);
    const runDone = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(runDone?.status).toBe("succeeded");
  });

  it("fails the run when policy denies a step (cancels remaining steps + releases leases)", async () => {
    const db = fixture.db();
    const snapshotDal = new PolicySnapshotDal(db);
    const snapshot = await snapshotDal.getOrCreate(
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "allow", allow: [], require_approval: [], deny: ["webfetch"] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );
    const engine = new ExecutionEngine({
      db,
      clock: () => ({ nowMs: Date.now(), nowIso: new Date().toISOString() }),
    });
    await enqueuePlan(engine, {
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
    expect(mockCallCount(executor)).toBe(0);
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
    expect(mockCallCount(executor)).toBe(0);
  });

  it("fails closed when a stored policy snapshot is malformed (override cannot auto-allow)", async () => {
    const db = fixture.db();
    const originalPolicyEnabled = process.env["TYRUM_POLICY_ENABLED"];
    process.env["TYRUM_POLICY_ENABLED"] = "1";
    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-invalid-snapshot-"));
    try {
      const snapshotDal = new PolicySnapshotDal(db);
      const overrideDal = new PolicyOverrideDal(db);
      const policyService = new PolicyService({ home, snapshotDal, overrideDal });
      const invalidSnapshotId = "11111111-1111-1111-8111-111111111111";
      await db.run(
        `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json) VALUES (?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, invalidSnapshotId, "invalid", JSON.stringify({ v: "invalid" })],
      );
      await overrideDal.create({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        toolId: "bash",
        pattern: "echo hi",
        createdFromPolicySnapshotId: invalidSnapshotId,
      });
      const engine = new ExecutionEngine({ db, policyService });
      await enqueuePlan(engine, {
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
      expect(mockCallCount(executor)).toBe(0);
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
}

function registerPolicyPersistenceTests(fixture: { db: () => SqliteDb }): void {
  it("persists policy decisions (reasons + snapshot + applied override ids) on attempts", async () => {
    const db = fixture.db();
    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });
    const snapshot = await snapshotDal.getOrCreate(DEFAULT_TENANT_ID, defaultPolicyBundle());
    const scopeIds = await new IdentityScopeDal(db).resolveScopeIds({
      agentKey: "agent-1",
      workspaceKey: "default",
    });
    const override = await overrideDal.create({
      tenantId: scopeIds.tenantId,
      agentId: scopeIds.agentId,
      workspaceId: scopeIds.workspaceId,
      toolId: "bash",
      pattern: "echo hi",
      createdFromPolicySnapshotId: snapshot.policy_snapshot_id,
    });
    const engine = new ExecutionEngine({ db, policyService });
    await enqueuePlan(engine, {
      key: "agent:agent-1:main",
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
    const db = fixture.db();
    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });
    const snapshot = await snapshotDal.getOrCreate(DEFAULT_TENANT_ID, defaultPolicyBundle());
    const engine = new ExecutionEngine({ db, policyService });
    await enqueuePlan(engine, {
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
    expect(mockCallCount(executor)).toBe(0);
    const paused = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(paused?.status).toBe("paused");
    expect(paused?.paused_reason).toBe("policy");
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND status = 'queued' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("policy");
    expect(approval?.resume_token).toBeTruthy();
    const approvalDal = new ApprovalDal(db);
    await approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval!.approval_id,
      decision: "approved",
    });
    await engine.resumeRun(approval!.resume_token!);
    await drain(engine, "w1", executor);
    expect(mockCallCount(executor)).toBe(1);
    await rm(home, { recursive: true, force: true });
  });

  it("evaluates secret policy using provider:scope when possible", async () => {
    const db = fixture.db();
    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-"));
    const snapshotDal = new PolicySnapshotDal(db);
    const overrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({ home, snapshotDal, overrideDal });
    const bundle = PolicyBundle.parse({
      v: 1,
      tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
      secrets: { default: "deny", allow: ["db:MY_API_KEY"], require_approval: [], deny: [] },
    });
    const snapshot = await snapshotDal.getOrCreate(DEFAULT_TENANT_ID, bundle);
    const secretProvider: SecretProvider = {
      resolve: vi.fn(async () => null),
      store: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      revoke: vi.fn(async () => false),
      list: vi.fn(async () => [
        {
          handle_id: "h1",
          provider: "db",
          scope: "MY_API_KEY",
          created_at: new Date().toISOString(),
        },
      ]),
    };
    const engine = new ExecutionEngine({
      db,
      policyService,
      secretProviderForTenant: () => secretProvider,
    });
    await enqueuePlan(engine, {
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
    expect(mockCallCount(executor)).toBe(1);
    expect(secretProvider.list).toHaveBeenCalled();
    const approvalCount = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals");
    expect(approvalCount?.n).toBe(0);
    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");
    await rm(home, { recursive: true, force: true });
  });

  it("persists policy decisions on attempts for non-tool actions", async () => {
    const db = fixture.db();
    const home = await mkdtemp(join(tmpdir(), "tyrum-policy-home-action-"));
    try {
      const snapshotDal = new PolicySnapshotDal(db);
      const overrideDal = new PolicyOverrideDal(db);
      const policyService = new PolicyService({ home, snapshotDal, overrideDal });
      const snapshot = await snapshotDal.getOrCreate(
        DEFAULT_TENANT_ID,
        PolicyBundle.parse({
          v: 1,
          tools: { default: "allow", allow: [], require_approval: [], deny: [] },
          network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
        }),
      );
      const engine = new ExecutionEngine({ db, policyService });
      await enqueuePlan(engine, {
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
      expect(mockCallCount(executor)).toBe(1);
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
}

export function registerPolicyEvaluationTests(fixture: { db: () => SqliteDb }): void {
  registerPolicyApprovalTests(fixture);
  registerPolicyPersistenceTests(fixture);
}
