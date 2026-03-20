import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
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
    await seedPausedExecutionRun({ db, jobId: "job-1", runId: "run-1" });

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      motivation: "Resume the paused run when this approval is granted.",
      kind: "workflow_step",
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
    await seedPausedExecutionRun({ db, jobId: "job-2", runId: "run-2" });

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Resume run?",
      motivation: "Expired approvals must not enqueue new engine actions.",
      kind: "workflow_step",
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

  it("resolves work intervention approvals through the workboard service", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-approval-route",
      item: { kind: "action", title: "Resume intervention work", acceptance: { done: true } },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "done",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

    const task = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    const pausedSubagent = await workboard.createSubagent({
      scope,
      subagent: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "executor_rw",
        session_key: `agent:default:subagent:${item.work_item_id}`,
      },
    });
    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `work-intervention:${randomUUID()}`,
      prompt: "Resume intervention work?",
      motivation: "Manual intervention is required to continue this work item.",
      kind: "work.intervention",
      status: "awaiting_human",
      workItemId: item.work_item_id,
      workItemTaskId: task.task_id,
    });
    await workboard.updateTask({
      scope,
      task_id: task.task_id,
      patch: { approval_id: created.approval_id },
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
    app.route("/", createApprovalRoutes({ approvalDal, db }));

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", reason: "resume now" }),
    });
    expect(res.status).toBe(200);

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "ready",
    });
    expect(await workboard.getTask({ scope, task_id: task.task_id })).toMatchObject({
      status: "queued",
      result_summary: "resume now",
    });
    expect(
      await workboard.getSubagent({ scope, subagent_id: pausedSubagent.subagent_id }),
    ).toMatchObject({
      status: "closed",
    });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "unassigned" });
  });
});
