import { expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { makeDeps, makeClient } from "./ws-protocol.test-support.js";

function makeApprovalRow(input: {
  approvalId: string;
  status: "queued" | "reviewing" | "awaiting_human" | "approved" | "denied";
  context?: unknown;
  latestReview?: unknown;
}) {
  return {
    tenant_id: DEFAULT_TENANT_ID,
    approval_id: input.approvalId,
    approval_key: `approval:${input.approvalId}`,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
    kind: "policy" as const,
    status: input.status,
    prompt: "Ok?",
    motivation: "A review is required before continuing.",
    context: input.context ?? {},
    created_at: "2026-02-20T22:00:00.000Z",
    expires_at: null,
    latest_review: (input.latestReview ?? null) as never,
    session_id: null,
    plan_id: null,
    run_id: null,
    step_id: null,
    attempt_id: null,
    work_item_id: null,
    work_item_task_id: null,
    resume_token: null,
  };
}

/**
 * Approval list, approval resolve, and override tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerApprovalListAndResolveTests(): void {
  it("handles approval.list requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000aa";

    const approvalDal = {
      listBlocked: vi.fn(async () => {
        return [
          makeApprovalRow({
            approvalId,
            status: "awaiting_human",
            context: { x: 1 },
          }),
        ];
      }),
      getByStatus: vi.fn(async () => []),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        approvals: Array<{
          approval_id: string;
          agent_id?: string;
          created_at: string;
          latest_review: unknown;
        }>;
      };
    };
    expect(res.result.approvals).toHaveLength(1);
    expect(res.result.approvals[0]!.approval_id).toBe(approvalId);
    expect(res.result.approvals[0]!.agent_id).toBe(DEFAULT_AGENT_ID);
    expect(res.result.approvals[0]!.created_at).toContain("T");
    expect(res.result.approvals[0]!.created_at).toContain("Z");
    expect(res.result.approvals[0]!.latest_review).toBeNull();
  });

  it("requests newest-first ordering for terminal approval history", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalDal = {
      listBlocked: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
    };
    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-history",
        type: "approval.list",
        payload: { status: "approved", limit: 20 },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect(approvalDal.getByStatus).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      status: "approved",
      newestFirst: true,
    });
  });

  it("rejects approval.list when peer role is node", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;

    const approvalDal = {
      listBlocked: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("handles run.list requests when a DB is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const runId = "00000000-0000-4000-8000-000000000101";
    const stepId = "00000000-0000-4000-8000-000000000102";
    const attemptId = "00000000-0000-4000-8000-000000000103";
    const db = {
      all: vi.fn(async (sql: string) => {
        if (sql.includes("FROM execution_runs r")) {
          return [
            {
              run_id: runId,
              job_id: "00000000-0000-4000-8000-000000000104",
              key: "cron:watcher-1",
              lane: "heartbeat",
              status: "running",
              attempt: 1,
              created_at: "2026-02-20 22:00:00",
              started_at: "2026-02-20 22:00:01",
              finished_at: null,
              paused_reason: null,
              paused_detail: null,
              policy_snapshot_id: null,
              budgets_json: null,
              budget_overridden_at: null,
              agent_key: "default",
            },
          ];
        }
        if (sql.includes("FROM execution_steps")) {
          return [
            {
              step_id: stepId,
              run_id: runId,
              step_index: 0,
              status: "running",
              action_json: JSON.stringify({ type: "Decide", args: {} }),
              created_at: "2026-02-20 22:00:02",
              idempotency_key: null,
              postcondition_json: null,
              approval_id: null,
            },
          ];
        }
        if (sql.includes("FROM execution_attempts")) {
          return [
            {
              attempt_id: attemptId,
              step_id: stepId,
              attempt: 1,
              status: "running",
              started_at: "2026-02-20 22:00:03",
              finished_at: null,
              result_json: null,
              error: null,
              postcondition_report_json: null,
              artifacts_json: "[]",
              cost_json: null,
              metadata_json: null,
              policy_snapshot_id: null,
              policy_decision_json: null,
              policy_applied_override_ids_json: null,
            },
          ];
        }
        return [];
      }),
    };

    const deps = makeDeps(cm, { db: db as never });
    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-run-list",
        type: "run.list",
        payload: { limit: 25, statuses: ["queued", "running", "paused"] },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        runs: Array<{ run: { run_id: string; lane: string }; agent_key?: string }>;
        steps: Array<{ step_id: string }>;
        attempts: Array<{ attempt_id: string }>;
      };
    };
    expect(res.result.runs[0]?.run.run_id).toBe(runId);
    expect(res.result.runs[0]?.run.lane).toBe("heartbeat");
    expect(res.result.runs[0]?.agent_key).toBe("default");
    expect(res.result.steps[0]?.step_id).toBe(stepId);
    expect(res.result.attempts[0]?.attempt_id).toBe(attemptId);
  });

  it("handles approval.resolve requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ab";

    const resolveWithEngineAction = vi.fn(async () => {
      return {
        approval: makeApprovalRow({
          approvalId,
          status: "approved",
          latestReview: {
            review_id: "00000000-0000-4000-8000-0000000000ff",
            target_type: "approval",
            target_id: approvalId,
            reviewer_kind: "human",
            reviewer_id: "client-1",
            state: "approved",
            reason: "looks good",
            risk_level: null,
            risk_score: null,
            evidence: null,
            decision_payload: { decision: "approved", reason: "looks good", mode: "once" },
            created_at: "2026-02-20T22:00:05.000Z",
            started_at: "2026-02-20T22:00:05.000Z",
            completed_at: "2026-02-20T22:00:05.000Z",
          },
        }),
        transitioned: true,
      };
    });

    const approvalDal = {
      listBlocked: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      resolveWithEngineAction,
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-2",
        type: "approval.resolve",
        payload: { approval_id: approvalId, decision: "approved", reason: "looks good" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: {
        approval: {
          approval_id: string;
          status: string;
          latest_review: { decision_payload: { decision: string } } | null;
        };
      };
    };
    expect(res.result.approval.approval_id).toBe(approvalId);
    expect(res.result.approval.status).toBe("approved");
    expect(res.result.approval.latest_review?.decision_payload.decision).toBe("approved");
  });
}

function registerOverrideTests(): void {
  it("does not create approve-always overrides when the approval resolves to denied", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ac";

    const approvalDal = {
      listBlocked: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () =>
        makeApprovalRow({
          approvalId,
          status: "awaiting_human",
          context: {
            policy: {
              agent_id: DEFAULT_AGENT_ID,
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                {
                  tool_id: "bash",
                  pattern: "echo hi",
                  workspace_id: DEFAULT_WORKSPACE_ID,
                },
              ],
            },
          },
        }),
      ),
      resolveWithEngineAction: vi.fn(async () => ({
        approval: makeApprovalRow({
          approvalId,
          status: "denied",
          latestReview: {
            review_id: "00000000-0000-4000-8000-0000000000fe",
            target_type: "approval",
            target_id: approvalId,
            reviewer_kind: "human",
            reviewer_id: "client-1",
            state: "denied",
            reason: "no",
            risk_level: null,
            risk_score: null,
            evidence: null,
            decision_payload: { decision: "denied", reason: "no", mode: "always" },
            created_at: "2026-02-20T22:00:05.000Z",
            started_at: "2026-02-20T22:00:05.000Z",
            completed_at: "2026-02-20T22:00:05.000Z",
          },
        }),
        transitioned: true,
      })),
    };

    const policyOverrideDal = {
      create: vi.fn(async () => {
        return {
          policy_override_id: "00000000-0000-4000-8000-000000000001",
          status: "active",
          created_at: new Date().toISOString(),
          created_by: { kind: "ws" },
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          tool_id: "bash",
          pattern: "echo hi",
          created_from_approval_id: approvalId,
          created_from_policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
        };
      }),
    };

    const deps = makeDeps(cm, {
      approvalDal: approvalDal as never,
      policyOverrideDal: policyOverrideDal as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-3",
        type: "approval.resolve",
        payload: {
          approval_id: approvalId,
          decision: "approved",
          mode: "always",
          overrides: [{ tool_id: "bash", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID }],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as {
      result: { approval: { status: string }; created_overrides?: unknown[] };
    };
    expect(res.result.approval.status).toBe("denied");
    expect(res.result.created_overrides).toBeUndefined();
    expect(policyOverrideDal.create).not.toHaveBeenCalled();
  });

  it("rejects approve-always override selection when the pattern violates guardrails", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const approvalId = "00000000-0000-4000-8000-0000000000ad";

    const approvalDal = {
      listBlocked: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      getById: vi.fn(async () =>
        makeApprovalRow({
          approvalId,
          status: "awaiting_human",
          context: {
            policy: {
              agent_id: DEFAULT_AGENT_ID,
              policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
              suggested_overrides: [
                {
                  tool_id: "bash",
                  pattern: "echo *",
                  workspace_id: DEFAULT_WORKSPACE_ID,
                },
              ],
            },
          },
        }),
      ),
      resolveWithEngineAction: vi.fn(async () => {
        throw new Error("resolveWithEngineAction should not be called when guardrails reject");
      }),
    };

    const policyOverrideDal = {
      create: vi.fn(async () => {
        return {
          policy_override_id: "00000000-0000-4000-8000-000000000001",
          status: "active",
          created_at: new Date().toISOString(),
          created_by: { kind: "ws" },
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
          tool_id: "bash",
          pattern: "echo *",
          created_from_approval_id: approvalId,
          created_from_policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
        };
      }),
    };

    const deps = makeDeps(cm, {
      approvalDal: approvalDal as never,
      policyOverrideDal: policyOverrideDal as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-4",
        type: "approval.resolve",
        payload: {
          approval_id: approvalId,
          decision: "approved",
          mode: "always",
          overrides: [{ tool_id: "bash", pattern: "echo *", workspace_id: DEFAULT_WORKSPACE_ID }],
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    const err = result as unknown as { error: { code: string; message: string } };
    expect(err.error.code).toBe("invalid_request");
    expect(policyOverrideDal.create).not.toHaveBeenCalled();
  });
}

export function registerHandleMessageResolveTests(): void {
  registerApprovalListAndResolveTests();
  registerOverrideTests();
}
