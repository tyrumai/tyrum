import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApproval } from "../../src/modules/approval/resolve-service.js";
import { ApprovalDal, type ApprovalRow } from "../../src/modules/approval/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("resolveApproval", () => {
  let db: SqliteDb | undefined;

  function makeApprovalRow(overrides?: Partial<ApprovalRow>): ApprovalRow {
    return {
      tenant_id: DEFAULT_TENANT_ID,
      approval_id: randomUUID(),
      approval_key: `approval:${randomUUID()}`,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Allow tool?",
      motivation: "Human review is required.",
      context: {},
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
      latest_review: null,
      session_id: null,
      plan_id: null,
      run_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
      ...overrides,
    };
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("skips eager approval lookup for once resolutions", async () => {
    let getByIdCalls = 0;
    let resolveCalls = 0;
    const approval = makeApprovalRow({ status: "approved" });

    const result = await resolveApproval(
      {
        approvalDal: {
          getById: async () => {
            getByIdCalls += 1;
            return approval;
          },
          resolveWithEngineAction: async () => {
            resolveCalls += 1;
            return { approval, transitioned: true };
          },
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
        mode: "once",
        resolvedBy: { kind: "http" },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.transitioned).toBe(true);
    expect(getByIdCalls).toBe(0);
    expect(resolveCalls).toBe(1);
  });

  it("resolves approve-always once and keeps duplicate resolves idempotent", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const emittedTypes: string[] = [];

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow bash?",
      motivation: "Human review is required before creating a standing bash override.",
      kind: "policy",
      status: "awaiting_human",
      context: {
        policy: {
          suggested_overrides: [
            { tool_id: "bash", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      },
    });

    const first = await resolveApproval(
      {
        approvalDal,
        policyOverrideDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "bash", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID }],
        resolvedBy: { kind: "http" },
      },
    );

    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    expect(first.transitioned).toBe(true);
    expect(first.approval.status).toBe("approved");
    expect(first.createdOverrides).toHaveLength(1);
    expect(emittedTypes).toEqual(["policy_override.created", "approval.updated"]);
    expect(
      (
        await approvalDal.getById({
          tenantId: DEFAULT_TENANT_ID,
          approvalId: approval.approval_id,
          includeReviews: true,
        })
      )?.latest_review?.decision_payload,
    ).toEqual({
      decision: "approved",
      reason: null,
      mode: "always",
      selected_overrides: [
        { tool_id: "bash", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
      ],
      actor: { kind: "http" },
    });

    const second = await resolveApproval(
      {
        approvalDal,
        emitEvent: ({ event }) => {
          emittedTypes.push(event.type);
        },
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "bash", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID }],
        resolvedBy: { kind: "http" },
      },
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.message);
    expect(second.transitioned).toBe(false);
    expect(second.approval.status).toBe("approved");
    expect(second.createdOverrides).toBeUndefined();
    expect(emittedTypes).toEqual(["policy_override.created", "approval.updated"]);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "bash",
      }),
    ).toHaveLength(1);
  });

  it("rejects invalid override workspace ids before mutating approval state", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow bash?",
      motivation: "Human review is required before creating a standing bash override.",
      kind: "policy",
      status: "awaiting_human",
      context: {
        policy: {
          suggested_overrides: [
            { tool_id: "bash", pattern: "echo hi", workspace_id: "not-a-uuid" },
          ],
        },
      },
    });

    const result = await resolveApproval(
      {
        approvalDal,
        policyOverrideDal,
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "bash", pattern: "echo hi", workspace_id: "not-a-uuid" }],
        resolvedBy: { kind: "http" },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid_request",
      message: "workspace_id must be a UUID",
    });
    expect(
      await approvalDal.getById({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
      }),
    ).toMatchObject({ status: "awaiting_human" });
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "bash",
      }),
    ).toHaveLength(0);
  });

  it("allows humans to resolve queued approvals directly", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool?",
      motivation: "Guardian review may not be available for this approval.",
      kind: "policy",
      status: "queued",
    });

    const result = await resolveApproval(
      {
        approvalDal,
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
        resolvedBy: { kind: "http" },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.transitioned).toBe(true);
    expect(result.approval.status).toBe("approved");
    expect(result.approval.latest_review).toMatchObject({
      reviewer_kind: "human",
      state: "approved",
    });
  });

  it("keeps reviewing approvals reserved for the guardian", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool?",
      motivation: "Guardian review is already in progress.",
      kind: "policy",
      status: "reviewing",
    });

    const result = await resolveApproval(
      {
        approvalDal,
      },
      {
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "denied",
        resolvedBy: { kind: "http" },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid_request",
      message: "approval is still being reviewed by the guardian",
    });
  });
});
