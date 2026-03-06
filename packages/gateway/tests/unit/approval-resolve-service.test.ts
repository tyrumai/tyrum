import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApproval } from "../../src/modules/approval/resolve-service.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("resolveApproval", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
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
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
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
        overrides: [
          { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
        ],
        resolvedBy: { kind: "http" },
      },
    );

    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    expect(first.transitioned).toBe(true);
    expect(first.approval.status).toBe("approved");
    expect(first.createdOverrides).toHaveLength(1);
    expect(emittedTypes).toEqual(["policy_override.created", "approval.resolved"]);

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
        overrides: [
          { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
        ],
        resolvedBy: { kind: "http" },
      },
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.message);
    expect(second.transitioned).toBe(false);
    expect(second.approval.status).toBe("approved");
    expect(second.createdOverrides).toBeUndefined();
    expect(emittedTypes).toEqual(["policy_override.created", "approval.resolved"]);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
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
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: "not-a-uuid" },
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
        overrides: [{ tool_id: "tool.exec", pattern: "echo hi", workspace_id: "not-a-uuid" }],
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
    ).toMatchObject({ status: "pending" });
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(0);
  });
});
