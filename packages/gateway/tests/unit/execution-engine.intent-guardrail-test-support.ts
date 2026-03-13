import { expect, it, vi } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import { maybePauseForToolIntentGuardrailTx } from "../../src/modules/execution/engine/execution-engine-intent-guardrail.js";
import {
  sha256HexFromString,
  stableJsonStringify,
} from "../../src/modules/policy/canonical-json.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  action,
  enqueuePlan,
  drain,
  mockCallCount,
  AbortableTx,
  DEFAULT_SCOPE,
  DEFAULT_TENANT_ID,
} from "./execution-engine.test-support.js";

export function registerIntentGuardrailTests(fixture: { db: () => SqliteDb }): void {
  it("pauses side-effecting steps when ToolIntent is missing for a work item run", async () => {
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
    await enqueuePlan(engine, {
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
    expect(mockCallCount(mockExecutor)).toBe(0);
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs LIMIT 1",
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");
    const approval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE tenant_id = ? AND status = 'queued' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
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
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
    await enqueuePlan(engine, {
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
    expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
    expect(mockCallCount(mockExecutor)).toBe(0);
    const approval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND status = 'queued' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID],
    );
    expect(approval?.kind).toBe("intent");
    expect(approval?.resume_token).toBeTruthy();
    const approvalDal = new ApprovalDal(db);
    await approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval!.approval_id,
      decision: "approved",
    });
    await engine.resumeRun(approval!.resume_token!);
    await drain(engine, "w1", mockExecutor);
    expect(mockCallCount(mockExecutor)).toBe(1);
    const run = await db.get<{ status: string }>("SELECT status FROM execution_runs LIMIT 1");
    expect(run?.status).toBe("succeeded");
  });

  it("pauses even if intent guardrail evidence writes fail (Postgres aborted tx simulation)", async () => {
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
    const { runId } = await enqueuePlan(engine, {
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
        `SELECT r.tenant_id, r.run_id, r.job_id, j.agent_id, r.key, r.lane, r.status, j.trigger_json, j.workspace_id, r.policy_snapshot_id FROM execution_runs r JOIN execution_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id WHERE r.tenant_id = ? AND r.run_id = ?`,
        [DEFAULT_TENANT_ID, runId],
      );
      const step = await tx.get<unknown>(
        "SELECT * FROM execution_steps WHERE tenant_id = ? AND run_id = ? ORDER BY step_index ASC LIMIT 1",
        [DEFAULT_TENANT_ID, runId],
      );
      expect(run).toBeTruthy();
      expect(step).toBeTruthy();
      const paused = await maybePauseForToolIntentGuardrailTx(
        { approvalManager: (engine as any).approvalManager },
        tx,
        {
          run,
          step,
          actionType: "Http",
          action: undefined,
          clock: { nowMs: Date.now(), nowIso: new Date().toISOString() },
          workerId: "w1",
        },
      );
      expect(paused?.approvalId).toBeTypeOf("string");
    });
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");
    const approvalRow = await db.get<{ kind: string; status: string }>(
      "SELECT kind, status FROM approvals WHERE tenant_id = ? AND run_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(approvalRow?.kind).toBe("intent");
    expect(approvalRow?.status).toBe("queued");
  });

  it("pauses when ToolIntent intent_graph_sha256 does not match the current work item intent graph", async () => {
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
    const { runId } = await enqueuePlan(engine, {
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
    expect(mockCallCount(mockExecutor)).toBe(0);
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("approval");
    const approval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE tenant_id = ? AND run_id = ? AND status = 'queued' ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
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
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
    const { runId } = await enqueuePlan(engine, {
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
    expect(mockCallCount(mockExecutor)).toBe(1);
    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("succeeded");
    const pendingApprovals = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM approvals WHERE tenant_id = ? AND run_id = ? AND status = 'queued'",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(pendingApprovals?.n).toBe(0);
    const decisionCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM work_decisions WHERE work_item_id = ?",
      [item.work_item_id],
    );
    expect(decisionCount?.n).toBe(0);
  });

  it("does not treat an approved intent approval as a policy approval", async () => {
    const db = fixture.db();
    const workboard = new WorkboardDal(db);
    const scope = DEFAULT_SCOPE;
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
      DEFAULT_TENANT_ID,
      PolicyBundle.parse({
        v: 1,
        tools: { default: "require_approval", allow: [], require_approval: [], deny: [] },
        network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
      }),
    );
    const engine = new ExecutionEngine({ db });
    const { runId } = await enqueuePlan(engine, {
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
    expect(await engine.workerTick({ workerId: "w1", executor, runId })).toBe(true);
    expect(mockCallCount(executor)).toBe(0);
    const intentApproval = await db.get<{
      approval_id: string;
      kind: string;
      resume_token: string | null;
    }>(
      "SELECT approval_id, kind, resume_token FROM approvals WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(intentApproval?.kind).toBe("intent");
    expect(intentApproval?.resume_token).toBeTruthy();
    const approvalDal = new ApprovalDal(db);
    await approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: intentApproval!.approval_id,
      decision: "approved",
    });
    await db.run(
      "UPDATE execution_runs SET policy_snapshot_id = ? WHERE tenant_id = ? AND run_id = ?",
      [snapshot.policy_snapshot_id, DEFAULT_TENANT_ID, runId],
    );
    const { decisions } = await workboard.listDecisions({ scope, work_item_id: item.work_item_id });
    const decisionIds = decisions
      .map((d) => d.decision_id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
    expect(await engine.workerTick({ workerId: "w1", executor, runId })).toBe(true);
    expect(mockCallCount(executor)).toBe(0);
    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(run?.paused_reason).toBe("policy");
    const policyApproval = await db.get<{ kind: string }>(
      "SELECT kind FROM approvals WHERE tenant_id = ? AND run_id = ? AND kind = 'policy' ORDER BY created_at DESC, approval_id DESC LIMIT 1",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(policyApproval?.kind).toBe("policy");
  });
}
