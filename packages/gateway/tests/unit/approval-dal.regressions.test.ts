import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ApprovalDal regressions", () => {
  let db: SqliteDb | undefined;

  const tenantId = DEFAULT_TENANT_ID;
  const agentId = DEFAULT_AGENT_ID;
  const workspaceId = DEFAULT_WORKSPACE_ID;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): ApprovalDal {
    db = openTestSqliteDb();
    return new ApprovalDal(db);
  }

  async function createApproval(
    dal: ApprovalDal,
    status: "queued" | "reviewing" | "awaiting_human",
  ) {
    return await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Approve?",
      motivation: "Human or guardian review is required before this action continues.",
      kind: "policy",
      status,
    });
  }

  it("preserves reviews on early returns when includeReviews is requested", async () => {
    const dal = createDal();
    const created = await createApproval(dal, "queued");
    const reviewing = await dal.transitionWithReview({
      tenantId,
      approvalId: created.approval_id,
      status: "reviewing",
      reviewerKind: "guardian",
      reviewState: "running",
      reason: "Guardian picked up the review.",
      allowedCurrentStatuses: ["queued"],
      includeReviews: true,
    });
    expect(reviewing?.transitioned).toBe(true);

    const unchanged = await dal.transitionWithReview({
      tenantId,
      approvalId: created.approval_id,
      status: "awaiting_human",
      reviewerKind: "guardian",
      reviewState: "requested_human",
      reason: "This should not apply while the approval is already reviewing.",
      allowedCurrentStatuses: ["queued"],
      includeReviews: true,
    });

    expect(unchanged?.transitioned).toBe(false);
    expect(unchanged?.approval.status).toBe("reviewing");
    expect(unchanged?.approval.reviews).toHaveLength(1);
    expect(unchanged?.approval.reviews?.[0]).toMatchObject({
      reviewer_kind: "guardian",
      state: "running",
      reason: "Guardian picked up the review.",
    });
  });

  it("discards speculative reviews when the transition compare-and-swap loses a race", async () => {
    const approvalId = "approval-race-1";
    let approvalReadCount = 0;
    let createdReviewId = "";
    let deletedReviewCount = 0;

    const awaitingHumanRow = {
      tenant_id: tenantId,
      approval_id: approvalId,
      approval_key: "approval:key:race:1",
      agent_id: agentId,
      workspace_id: workspaceId,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Approve?",
      motivation: "Human or guardian review is required before this action continues.",
      context_json: "{}",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      latest_review_id: null as string | null,
      conversation_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    };
    const approvedRow = {
      ...awaitingHumanRow,
      status: "approved",
    };

    const handleGet = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("FROM approvals")) {
        approvalReadCount += 1;
        return (approvalReadCount === 1 ? awaitingHumanRow : approvedRow) as never;
      }
      if (sql.includes("INSERT INTO review_entries")) {
        createdReviewId = String(params[1]);
        return {
          tenant_id: tenantId,
          review_id: createdReviewId,
          target_type: "approval" as const,
          target_id: approvalId,
          reviewer_kind: "human" as const,
          reviewer_id: null,
          state: "approved" as const,
          reason: "approved safely",
          risk_level: null,
          risk_score: null,
          evidence_json: null,
          decision_payload_json: null,
          created_at: "2026-01-01T00:00:01.000Z",
          started_at: null,
          completed_at: "2026-01-01T00:00:01.000Z",
        } as never;
      }
      throw new Error(`unexpected get query: ${sql} :: ${JSON.stringify(params)}`);
    };

    const handleRun = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("UPDATE approvals") && sql.includes("latest_review_id")) {
        expect(sql).toContain("AND status = ?");
        expect(params[4]).toBe("awaiting_human");
        return { changes: 0 };
      }
      if (sql.includes("DELETE FROM review_entries")) {
        deletedReviewCount += 1;
        expect(params).toEqual([tenantId, createdReviewId]);
        return { changes: 1 };
      }
      throw new Error(`unexpected run query: ${sql} :: ${JSON.stringify(params)}`);
    };

    const txDb: SqlDb = {
      kind: "postgres",
      get: handleGet,
      all: async () => [],
      run: handleRun,
      exec: async () => {},
      transaction: async () => {
        throw new Error("nested transactions are not supported");
      },
      close: async () => {},
    };

    const rootDb: SqlDb = {
      kind: "postgres",
      get: handleGet,
      all: async () => [],
      run: handleRun,
      exec: async () => {},
      transaction: async (fn) => await fn(txDb),
      close: async () => {},
    };

    const dal = new ApprovalDal(rootDb);
    const resolved = await dal.resolveWithEngineAction({
      tenantId,
      approvalId,
      decision: "approved",
      reason: "approved safely",
    });

    expect(resolved?.transitioned).toBe(false);
    expect(resolved?.approval.status).toBe("approved");
    expect(deletedReviewCount).toBe(1);
  });

  it("batch-hydrates latest reviews for status listings", async () => {
    const approvalRows = [
      {
        tenant_id: tenantId,
        approval_id: "approval-1",
        approval_key: "approval:key:1",
        agent_id: agentId,
        workspace_id: workspaceId,
        kind: "policy",
        status: "queued",
        prompt: "Approval 1",
        motivation: "Motivation 1",
        context_json: "{}",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: null,
        latest_review_id: "review-1",
        conversation_id: null,
        plan_id: null,
        run_id: null,
        step_id: null,
        attempt_id: null,
        work_item_id: null,
        work_item_task_id: null,
        resume_token: null,
      },
      {
        tenant_id: tenantId,
        approval_id: "approval-2",
        approval_key: "approval:key:2",
        agent_id: agentId,
        workspace_id: workspaceId,
        kind: "policy",
        status: "queued",
        prompt: "Approval 2",
        motivation: "Motivation 2",
        context_json: "{}",
        created_at: "2026-01-01T00:00:01.000Z",
        expires_at: null,
        latest_review_id: "review-2",
        conversation_id: null,
        plan_id: null,
        run_id: null,
        step_id: null,
        attempt_id: null,
        work_item_id: null,
        work_item_task_id: null,
        resume_token: null,
      },
    ];
    const reviewRows = [
      {
        tenant_id: tenantId,
        review_id: "review-1",
        target_type: "approval",
        target_id: "approval-1",
        reviewer_kind: "guardian",
        reviewer_id: null,
        state: "queued",
        reason: "Queued",
        risk_level: null,
        risk_score: null,
        evidence_json: null,
        decision_payload_json: null,
        created_at: "2026-01-01T00:00:00.000Z",
        started_at: null,
        completed_at: null,
      },
      {
        tenant_id: tenantId,
        review_id: "review-2",
        target_type: "approval",
        target_id: "approval-2",
        reviewer_kind: "guardian",
        reviewer_id: null,
        state: "queued",
        reason: "Queued",
        risk_level: null,
        risk_score: null,
        evidence_json: null,
        decision_payload_json: null,
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: null,
        completed_at: null,
      },
    ];
    let approvalQueryCount = 0;
    let reviewBatchQueryCount = 0;

    const stubDb: SqlDb = {
      kind: "sqlite",
      get: async () => {
        throw new Error("getByStatus should not perform per-row review lookups");
      },
      all: async (sql) => {
        if (sql.includes("FROM approvals")) {
          approvalQueryCount += 1;
          return approvalRows as never;
        }
        if (sql.includes("FROM review_entries") && sql.includes("review_id IN")) {
          reviewBatchQueryCount += 1;
          return reviewRows as never;
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new ApprovalDal(stubDb);
    const queued = await dal.getByStatus({ tenantId, status: "queued" });

    expect(approvalQueryCount).toBe(1);
    expect(reviewBatchQueryCount).toBe(1);
    expect(queued.map((approval) => approval.latest_review?.review_id)).toEqual([
      "review-1",
      "review-2",
    ]);
  });

  it("expires stale approvals in bulk without per-row hydration", async () => {
    let staleUpdateCount = 0;
    let reviewInsertCount = 0;
    let reviewAttachCount = 0;

    const transitionedRows = [{ approval_id: "approval-1" }, { approval_id: "approval-2" }];
    const stubDb: SqlDb = {
      kind: "sqlite",
      get: async () => {
        throw new Error("expireStale should not rehydrate approvals row by row");
      },
      all: async (sql) => {
        if (sql.includes("UPDATE approvals") && sql.includes("RETURNING approval_id")) {
          staleUpdateCount += 1;
          return transitionedRows as never;
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      run: async (sql) => {
        if (sql.includes("INSERT INTO review_entries")) {
          reviewInsertCount += 1;
          return { changes: transitionedRows.length };
        }
        if (sql.includes("SET latest_review_id = CASE approval_id")) {
          reviewAttachCount += 1;
          return { changes: transitionedRows.length };
        }
        throw new Error(`unexpected statement: ${sql}`);
      },
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new ApprovalDal(stubDb);
    const expired = await dal.expireStale({ tenantId, nowIso: "2026-01-01T00:00:00.000Z" });

    expect(expired).toBe(2);
    expect(staleUpdateCount).toBe(1);
    expect(reviewInsertCount).toBe(1);
    expect(reviewAttachCount).toBe(1);
  });

  it("reuses the current transaction when resolving with engine actions", async () => {
    const approvalId = "approval-postgres-like-1";
    const latestReviewId = "review-postgres-like-1";
    let reviewCounter = 0;
    let outerTransactionCount = 0;
    let nestedTransactionCount = 0;

    const approvalRow = {
      tenant_id: tenantId,
      approval_id: approvalId,
      approval_key: "approval:key:postgres-like:1",
      agent_id: agentId,
      workspace_id: workspaceId,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Approve?",
      motivation: "Human or guardian review is required before this action continues.",
      context_json: "{}",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      latest_review_id: null as string | null,
      conversation_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    };
    const reviewRows = new Map<
      string,
      {
        tenant_id: string;
        review_id: string;
        target_type: "approval";
        target_id: string;
        reviewer_kind: "human";
        reviewer_id: null;
        state: "approved";
        reason: string;
        risk_level: null;
        risk_score: null;
        evidence_json: null;
        decision_payload_json: null;
        created_at: string;
        started_at: null;
        completed_at: string;
      }
    >();

    const handleGet = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("FROM approvals")) {
        return approvalRow as never;
      }
      if (sql.includes("INSERT INTO review_entries")) {
        reviewCounter += 1;
        const reviewId = latestReviewId.replace(/1$/, String(reviewCounter));
        const raw = {
          tenant_id: tenantId,
          review_id: reviewId,
          target_type: "approval" as const,
          target_id: approvalId,
          reviewer_kind: "human" as const,
          reviewer_id: null,
          state: "approved" as const,
          reason: "approved safely",
          risk_level: null,
          risk_score: null,
          evidence_json: null,
          decision_payload_json: null,
          created_at: "2026-01-01T00:00:01.000Z",
          started_at: null,
          completed_at: "2026-01-01T00:00:01.000Z",
        };
        reviewRows.set(reviewId, raw);
        return raw as never;
      }
      throw new Error(`unexpected get query: ${sql} :: ${JSON.stringify(params)}`);
    };

    const handleAll = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("FROM review_entries") && sql.includes("review_id IN")) {
        const requestedIds = params.slice(1).map((value) => String(value));
        const rows = requestedIds.flatMap((reviewId) => {
          const row = reviewRows.get(reviewId);
          return row ? [row] : [];
        });
        return rows as never;
      }
      throw new Error(`unexpected all query: ${sql} :: ${JSON.stringify(params)}`);
    };

    const handleRun = async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("UPDATE approvals") && sql.includes("latest_review_id")) {
        approvalRow.status = String(params[0]);
        approvalRow.latest_review_id = String(params[1]);
        return { changes: 1 };
      }
      throw new Error(`unexpected run query: ${sql} :: ${JSON.stringify(params)}`);
    };

    const txDb: SqlDb = {
      kind: "postgres",
      get: handleGet,
      all: handleAll,
      run: handleRun,
      exec: async () => {},
      transaction: async () => {
        nestedTransactionCount += 1;
        throw new Error("nested transactions are not supported");
      },
      close: async () => {},
    };

    const rootDb: SqlDb = {
      kind: "postgres",
      get: handleGet,
      all: handleAll,
      run: handleRun,
      exec: async () => {},
      transaction: async (fn) => {
        outerTransactionCount += 1;
        return await fn(txDb);
      },
      close: async () => {},
    };

    const dal = new ApprovalDal(rootDb);
    const resolved = await dal.resolveWithEngineAction({
      tenantId,
      approvalId,
      decision: "approved",
      reason: "approved safely",
    });

    expect(resolved?.transitioned).toBe(true);
    expect(resolved?.approval.status).toBe("approved");
    expect(resolved?.approval.latest_review).toMatchObject({
      state: "approved",
      reason: "approved safely",
    });
    expect(outerTransactionCount).toBe(1);
    expect(nestedTransactionCount).toBe(0);
  });
});
