import { afterEach, describe, expect, it } from "vitest";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { resolveAndApplyApproval } from "../../src/modules/approval/apply.js";
import { PolicyOverrideDal } from "../../src/modules/policy-overrides/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("approve-always (policy overrides via approvals)", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("creates a durable policy override when approving with mode=always", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const overrideDal = new PolicyOverrideDal(db);

    const approval = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve tool.exec",
      context: {
        suggested_overrides: [
          {
            tool_id: "tool.exec",
            pattern: "git status --porcelain",
            match_target: "git status --porcelain",
            agent_id: "agent-1",
            workspace_id: "default",
          },
        ],
        policy_snapshot_id: "policy-snap-1",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await resolveAndApplyApproval({
      approvalDal,
      approvalId: approval.id,
      decision: "approved",
      reason: "ok",
      mode: "always",
      selectedOverride: { tool_id: "tool.exec", pattern: "git status --porcelain" },
      resolvedBy: { source: "test" },
    });

    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;

    expect(res.approval.status).toBe("approved");
    expect(res.approval.response_mode).toBe("always");
    expect(res.approval.policy_override_id).toMatch(/^pov-/);

    const override = await overrideDal.getById(res.approval.policy_override_id!);
    expect(override).toBeTruthy();
    expect(override!.status).toBe("active");
    expect(override!.tool_id).toBe("tool.exec");
    expect(override!.pattern).toBe("git status --porcelain");
    expect(override!.agent_id).toBe("agent-1");
    expect(override!.workspace_id).toBe("default");
    expect(override!.created_from_approval_id).toBe(res.approval.id);
    expect(override!.created_from_policy_snapshot_id).toBe("policy-snap-1");
  });

  it("rejects approve-always when selected_override does not match the approval suggestions", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const approval = await approvalDal.create({
      planId: "plan-2",
      stepIndex: 0,
      prompt: "Approve tool.exec",
      context: {
        suggested_overrides: [
          {
            tool_id: "tool.exec",
            pattern: "git status --porcelain",
            agent_id: "agent-1",
            workspace_id: "default",
          },
        ],
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await resolveAndApplyApproval({
      approvalDal,
      approvalId: approval.id,
      decision: "approved",
      mode: "always",
      selectedOverride: { tool_id: "tool.exec", pattern: "git diff" },
      resolvedBy: { source: "test" },
    });

    expect(res.kind).toBe("invalid_request");

    const current = await approvalDal.getById(approval.id);
    expect(current?.status).toBe("pending");
  });
});

