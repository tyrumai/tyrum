import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("approval respond engine actions", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not apply opposite engine action when already approved", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      runId: "run-1",
      resumeToken: "resume-1",
    });

    const engine = {
      resumeRun: vi.fn(async () => created.run_id ?? undefined),
      cancelRun: vi.fn(async () => "cancelled" as const),
    } as unknown as ExecutionEngine;

    const app = new Hono();
    app.route("/", createApprovalRoutes({ approvalDal, engine }));

    const approveRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(approveRes.status).toBe(200);

    expect(engine.resumeRun).toHaveBeenCalledTimes(1);
    expect(engine.resumeRun).toHaveBeenCalledWith("resume-1");
    expect(engine.cancelRun).toHaveBeenCalledTimes(0);

    const denyRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "denied", reason: "no thanks" }),
    });
    expect(denyRes.status).toBe(200);

    expect(engine.resumeRun).toHaveBeenCalledTimes(1);
    expect(engine.cancelRun).toHaveBeenCalledTimes(0);
  });

  it("does not apply engine actions for expired approvals", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      runId: "run-2",
      resumeToken: "resume-2",
    });

    await approvalDal.expireById({ tenantId: DEFAULT_TENANT_ID, approvalId: created.approval_id });

    const engine = {
      resumeRun: vi.fn(async () => created.run_id ?? undefined),
      cancelRun: vi.fn(async () => "cancelled" as const),
    } as unknown as ExecutionEngine;

    const app = new Hono();
    app.route("/", createApprovalRoutes({ approvalDal, engine }));

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);

    expect(engine.resumeRun).toHaveBeenCalledTimes(0);
    expect(engine.cancelRun).toHaveBeenCalledTimes(0);
  });
});
