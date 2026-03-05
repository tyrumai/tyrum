import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ApprovalEngineActionDal } from "../../src/modules/approval/engine-action-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("ApprovalEngineActionDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not allow a worker to finalize an action after lease loss", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const actionDal = new ApprovalEngineActionDal(db);

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      runId: randomUUID(),
      resumeToken: `resume-${randomUUID()}`,
    });

    await approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      resolvedBy: { kind: "test" },
    });

    const firstClaim = await actionDal.claimNext({
      tenantId: DEFAULT_TENANT_ID,
      owner: "worker-a",
      nowMs: 1000,
      nowIso: new Date(1000).toISOString(),
      leaseTtlMs: 1,
      maxAttempts: 10,
    });
    expect(firstClaim?.lease_owner).toBe("worker-a");

    const secondClaim = await actionDal.claimNext({
      tenantId: DEFAULT_TENANT_ID,
      owner: "worker-b",
      nowMs: 1001,
      nowIso: new Date(1001).toISOString(),
      leaseTtlMs: 1,
      maxAttempts: 10,
    });
    expect(secondClaim?.action_id).toBe(firstClaim?.action_id);
    expect(secondClaim?.lease_owner).toBe("worker-b");

    const okA = await actionDal.markSucceeded({
      tenantId: DEFAULT_TENANT_ID,
      actionId: firstClaim!.action_id,
      owner: "worker-a",
      nowIso: new Date(1002).toISOString(),
    });
    expect(okA).toBe(false);

    const okB = await actionDal.markSucceeded({
      tenantId: DEFAULT_TENANT_ID,
      actionId: firstClaim!.action_id,
      owner: "worker-b",
      nowIso: new Date(1003).toISOString(),
    });
    expect(okB).toBe(true);

    const finalRow = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "resume_run",
    });
    expect(finalRow?.status).toBe("succeeded");
    expect(finalRow?.attempts).toBe(2);
  });

  it("enqueues cancel_run when an approval is approved but missing a resume token", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const actionDal = new ApprovalEngineActionDal(db);

    const runId = randomUUID();
    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Continue without resume token?",
      runId,
    });

    await approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      resolvedBy: { kind: "test" },
    });

    const action = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "cancel_run",
    });
    expect(action?.run_id).toBe(runId);
    expect(action?.reason).toContain("missing resume token");
  });
});
