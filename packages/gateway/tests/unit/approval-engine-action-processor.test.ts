import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ApprovalEngineActionDal } from "../../src/modules/approval/engine-action-dal.js";
import { ApprovalEngineActionProcessor } from "../../src/modules/approval/engine-action-processor.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { seedApprovalLinkedExecutionRun } from "../helpers/execution-fixtures.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { randomUUID } from "node:crypto";

describe("ApprovalEngineActionProcessor", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("processes a queued resume_run action once", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const actionDal = new ApprovalEngineActionDal(db);
    const runId = randomUUID();
    await seedApprovalLinkedExecutionRun({ db, runId });

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      motivation: "Queued resume actions should be processed exactly once.",
      kind: "workflow_step",
      status: "awaiting_human",
      runId,
      resumeToken: `resume-${randomUUID()}`,
    });

    await approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      resolvedBy: { kind: "test" },
    });

    const queued = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "resume_run",
    });
    expect(queued?.status).toBe("queued");

    let resumeCalls = 0;
    const engine = {
      resumeRun: async (_token: string) => {
        resumeCalls += 1;
        return approval.run_id ?? undefined;
      },
      cancelRun: async () => "cancelled" as const,
    } as unknown as ExecutionEngine;

    const processor = new ApprovalEngineActionProcessor({
      db,
      engine,
      owner: "test-owner",
      tickMs: 1,
      leaseTtlMs: 10_000,
      maxAttempts: 3,
      batchSize: 1,
    });

    await processor.tick();

    expect(resumeCalls).toBe(1);

    const succeeded = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "resume_run",
    });
    expect(succeeded?.status).toBe("succeeded");
    expect(succeeded?.attempts).toBe(1);
    expect(succeeded?.lease_owner).toBeNull();
    expect(succeeded?.processed_at).not.toBeNull();
  });

  it("retries transient failures and records last_error", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const actionDal = new ApprovalEngineActionDal(db);
    const runId = randomUUID();
    await seedApprovalLinkedExecutionRun({ db, runId });

    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Cancel run?",
      motivation: "Transient engine failures should retry while preserving last_error.",
      kind: "workflow_step",
      status: "awaiting_human",
      runId,
      resumeToken: `resume-${randomUUID()}`,
    });

    await approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "denied",
      reason: "no",
      resolvedBy: { kind: "test" },
    });

    let calls = 0;
    const engine = {
      resumeRun: async () => undefined,
      cancelRun: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("transient");
        }
        return "cancelled" as const;
      },
    } as unknown as ExecutionEngine;

    const processor = new ApprovalEngineActionProcessor({
      db,
      engine,
      owner: "test-owner",
      tickMs: 1,
      leaseTtlMs: 10_000,
      maxAttempts: 3,
      batchSize: 1,
    });

    await processor.tick();
    expect(calls).toBe(1);
    const afterFirst = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "cancel_run",
    });
    expect(afterFirst?.status).toBe("queued");
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.last_error).toContain("transient");

    await processor.tick();
    const afterSecond = await actionDal.getByApprovalIdAndKind({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      actionKind: "cancel_run",
    });
    expect(afterSecond?.status).toBe("succeeded");
    expect(afterSecond?.attempts).toBe(2);
  });
});
