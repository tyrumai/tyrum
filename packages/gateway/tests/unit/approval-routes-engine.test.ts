import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
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

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      return await next();
    });
    app.route("/", createApprovalRoutes({ approvalDal }));

    const approveRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(approveRes.status).toBe(200);

    const afterApprove = await db.all<{ action_kind: string; resume_token: string | null }>(
      `SELECT action_kind, resume_token
       FROM approval_engine_actions
       WHERE tenant_id = ? AND approval_id = ?
       ORDER BY action_kind ASC`,
      [DEFAULT_TENANT_ID, created.approval_id],
    );
    expect(afterApprove).toEqual([{ action_kind: "resume_run", resume_token: "resume-1" }]);

    const denyRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "denied", reason: "no thanks" }),
    });
    expect(denyRes.status).toBe(200);

    const afterDeny = await db.all<{ action_kind: string }>(
      `SELECT action_kind
       FROM approval_engine_actions
       WHERE tenant_id = ? AND approval_id = ?
       ORDER BY action_kind ASC`,
      [DEFAULT_TENANT_ID, created.approval_id],
    );
    expect(afterDeny).toEqual([{ action_kind: "resume_run" }]);
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

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      return await next();
    });
    app.route("/", createApprovalRoutes({ approvalDal }));

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);

    const rows = await db.all<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM approval_engine_actions
       WHERE tenant_id = ? AND approval_id = ?`,
      [DEFAULT_TENANT_ID, created.approval_id],
    );
    expect(rows[0]?.n ?? 0).toBe(0);
  });
});
