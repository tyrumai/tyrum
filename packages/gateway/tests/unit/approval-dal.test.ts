import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ApprovalDal", () => {
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
    input?: {
      approvalKey?: string;
      prompt?: string;
      motivation?: string;
      kind?: "policy" | "workflow_step";
      status?: "queued" | "reviewing" | "awaiting_human";
      expiresAt?: string | null;
      resumeToken?: string | null;
    },
  ) {
    return await dal.create({
      tenantId,
      agentId,
      workspaceId,
      approvalKey: input?.approvalKey ?? `approval:${randomUUID()}`,
      prompt: input?.prompt ?? "Approve?",
      motivation:
        input?.motivation ?? "Human or guardian review is required before this action continues.",
      kind: input?.kind ?? "policy",
      status: input?.status,
      expiresAt: input?.expiresAt,
      resumeToken: input?.resumeToken,
    });
  }

  it("creates a queued approval by default", async () => {
    const dal = createDal();
    const approvalKey = `approval:${randomUUID()}`;

    const approval = await createApproval(dal, {
      approvalKey,
      prompt: "Allow web scrape of example.com?",
      motivation: "The workflow needs to scrape example.com before it can continue.",
    });

    expect(approval.tenant_id).toBe(tenantId);
    expect(approval.approval_key).toBe(approvalKey);
    expect(approval.approval_id).toMatch(/[0-9a-fA-F-]{36}/);
    expect(approval.prompt).toBe("Allow web scrape of example.com?");
    expect(approval.motivation).toBe(
      "The workflow needs to scrape example.com before it can continue.",
    );
    expect(approval.context).toEqual({});
    expect(approval.status).toBe("queued");
    expect(approval.latest_review).toBeNull();
  });

  it("is idempotent on approval_key", async () => {
    const dal = createDal();
    const approvalKey = `approval:${randomUUID()}`;

    const first = await createApproval(dal, {
      approvalKey,
      prompt: "Keep original prompt",
      motivation: "Keep original motivation",
    });
    const second = await createApproval(dal, {
      approvalKey,
      prompt: "Ignored prompt",
      motivation: "Ignored motivation",
    });

    expect(second.approval_id).toBe(first.approval_id);
    expect(second.prompt).toBe(first.prompt);
    expect(second.motivation).toBe(first.motivation);
  });

  it("retrieves approvals by id and resume token", async () => {
    const dal = createDal();
    const resumeToken = `resume-${randomUUID()}`;
    const created = await createApproval(dal, {
      kind: "workflow_step",
      status: "awaiting_human",
      resumeToken,
    });

    const fetchedById = await dal.getById({ tenantId, approvalId: created.approval_id });
    const fetchedByToken = await dal.getByResumeToken({ tenantId, resumeToken });

    expect(fetchedById?.approval_id).toBe(created.approval_id);
    expect(fetchedByToken?.approval_id).toBe(created.approval_id);
    expect(fetchedByToken?.status).toBe("awaiting_human");
  });

  it("transitions queued approvals into awaiting_human with a review entry", async () => {
    const dal = createDal();
    const created = await createApproval(dal, { status: "queued" });

    const transitioned = await dal.transitionWithReview({
      tenantId,
      approvalId: created.approval_id,
      status: "awaiting_human",
      reviewerKind: "guardian",
      reviewState: "requested_human",
      reason: "This action needs a human to review the risk.",
      riskLevel: "high",
      riskScore: 812,
      allowedCurrentStatuses: ["queued"],
      includeReviews: true,
    });

    expect(transitioned?.transitioned).toBe(true);
    expect(transitioned?.approval.status).toBe("awaiting_human");
    expect(transitioned?.approval.latest_review).toMatchObject({
      reviewer_kind: "guardian",
      state: "requested_human",
      reason: "This action needs a human to review the risk.",
      risk_level: "high",
      risk_score: 812,
    });
    expect(transitioned?.approval.reviews).toHaveLength(1);
  });

  it("approves an awaiting_human approval and records the human review", async () => {
    const dal = createDal();
    const created = await createApproval(dal, { status: "awaiting_human" });

    const updated = await dal.resolveWithEngineAction({
      tenantId,
      approvalId: created.approval_id,
      decision: "approved",
      reason: "looks safe",
    });

    expect(updated?.transitioned).toBe(true);
    expect(updated?.approval.status).toBe("approved");
    expect(updated?.approval.latest_review).toMatchObject({
      reviewer_kind: "human",
      state: "approved",
      reason: "looks safe",
    });
  });

  it("denies an awaiting_human approval and keeps duplicate resolves idempotent", async () => {
    const dal = createDal();
    const created = await createApproval(dal, { status: "awaiting_human" });

    const first = await dal.resolveWithEngineAction({
      tenantId,
      approvalId: created.approval_id,
      decision: "denied",
      reason: "too risky",
    });
    const second = await dal.resolveWithEngineAction({
      tenantId,
      approvalId: created.approval_id,
      decision: "approved",
      reason: "should not apply",
    });

    expect(first?.transitioned).toBe(true);
    expect(first?.approval.status).toBe("denied");
    expect(second?.transitioned).toBe(false);
    expect(second?.approval.status).toBe("denied");
  });

  it("lists blocked approvals newest first", async () => {
    const dal = createDal();
    const queued = await createApproval(dal, {
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Queued",
      status: "queued",
    });
    const reviewing = await createApproval(dal, {
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Reviewing",
      status: "reviewing",
    });
    const awaitingHuman = await createApproval(dal, {
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Awaiting human",
      status: "awaiting_human",
    });

    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2026-01-01T00:00:00.000Z",
      tenantId,
      queued.approval_id,
    ]);
    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2026-01-01T00:00:01.000Z",
      tenantId,
      reviewing.approval_id,
    ]);
    await db!.run("UPDATE approvals SET created_at = ? WHERE tenant_id = ? AND approval_id = ?", [
      "2026-01-01T00:00:02.000Z",
      tenantId,
      awaitingHuman.approval_id,
    ]);

    const blocked = await dal.listBlocked({ tenantId });
    expect(blocked.map((approval) => approval.prompt)).toEqual([
      "Awaiting human",
      "Reviewing",
      "Queued",
    ]);
  });

  it("expires stale blocked approvals", async () => {
    const dal = createDal();
    const created = await createApproval(dal, {
      status: "reviewing",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await createApproval(dal, {
      status: "awaiting_human",
      expiresAt: "2099-12-31T23:59:59.000Z",
    });

    const expired = await dal.expireStale({ tenantId, nowIso: "2026-01-01T00:00:00.000Z" });
    expect(expired).toBe(1);

    const row = await dal.getById({ tenantId, approvalId: created.approval_id });
    expect(row?.status).toBe("expired");
    expect(row?.latest_review).toMatchObject({
      reviewer_kind: "system",
      state: "expired",
    });
  });

  it("normalizes created_at when Postgres returns Date", async () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    const approvalId = randomUUID();
    const row = {
      tenant_id: tenantId,
      approval_id: approvalId,
      approval_key: `approval:${randomUUID()}`,
      agent_id: agentId,
      workspace_id: workspaceId,
      kind: "policy",
      status: "queued",
      prompt: "Approve?",
      motivation: "Motivation",
      context_json: "{}",
      created_at: createdAt,
      expires_at: null,
      latest_review_id: null,
      session_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    };

    const stubDb: SqlDb = {
      kind: "postgres",
      get: async () => row,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new ApprovalDal(stubDb);
    const fetched = await dal.getById({ tenantId, approvalId });
    expect(fetched?.created_at).toBe(createdAt.toISOString());
    expect(fetched?.motivation).toBe("Motivation");
    expect(fetched?.status).toBe("queued");
  });
});
