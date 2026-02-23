import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("approval respond policy overrides", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("rejects approve-always override creation when the selected pattern violates guardrails", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);

    const created = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Allow tool.exec?",
      agentId: "agent-1",
      workspaceId: "default",
      context: {
        policy: {
          agent_id: "agent-1",
          policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo *", workspace_id: "default" },
          ],
        },
      },
    });

    const app = new Hono();
    app.route("/", createApprovalRoutes({ approvalDal, policyOverrideDal }));

    const res = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "tool.exec", pattern: "echo *", workspace_id: "default" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await policyOverrideDal.list({ agentId: "agent-1", toolId: "tool.exec" })).toHaveLength(0);
  });

  it("does not create duplicate overrides when already resolved", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);

    const created = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Allow tool.exec?",
      agentId: "agent-1",
      workspaceId: "default",
      context: {
        policy: {
          agent_id: "agent-1",
          policy_snapshot_id: "00000000-0000-0000-0000-000000000000",
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: "default" },
          ],
        },
      },
    });

    const app = new Hono();
    app.route("/", createApprovalRoutes({ approvalDal, policyOverrideDal }));

    const reqBody = {
      decision: "approved",
      mode: "always",
      overrides: [{ tool_id: "tool.exec", pattern: "echo hi", workspace_id: "default" }],
    };

    const firstRes = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    expect(firstRes.status).toBe(200);

    const firstJson = (await firstRes.json()) as { created_overrides?: unknown[] };
    expect(firstJson.created_overrides).toHaveLength(1);
    expect(await policyOverrideDal.list({ agentId: "agent-1", toolId: "tool.exec" })).toHaveLength(1);

    const secondRes = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    expect(secondRes.status).toBe(200);

    const secondJson = (await secondRes.json()) as { created_overrides?: unknown[] };
    expect(secondJson.created_overrides).toBeUndefined();
    expect(await policyOverrideDal.list({ agentId: "agent-1", toolId: "tool.exec" })).toHaveLength(1);
  });
});
