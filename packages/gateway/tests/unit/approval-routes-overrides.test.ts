import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

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
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          agent_id: DEFAULT_AGENT_ID,
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo *", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      },
    });

    const routes = createApprovalRoutes({ approvalDal, policyOverrideDal });
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
    app.route("/", routes);

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [
          { tool_id: "tool.exec", pattern: "echo *", workspace_id: DEFAULT_WORKSPACE_ID },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(0);
  });

  it("returns 400 and keeps approval pending when override workspace_id is not a UUID", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const invalidWorkspaceId = "not-a-uuid";

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          agent_id: DEFAULT_AGENT_ID,
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: invalidWorkspaceId },
          ],
        },
      },
    });

    const routes = createApprovalRoutes({ approvalDal, policyOverrideDal });
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
    app.route("/", routes);

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "tool.exec", pattern: "echo hi", workspace_id: invalidWorkspaceId }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid_request",
      message: "workspace_id must be a UUID",
    });

    const approvalAfter = await approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: created.approval_id,
    });
    expect(approvalAfter?.status).toBe("pending");
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(0);
  });

  it("does not create duplicate overrides when already resolved", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          agent_id: DEFAULT_AGENT_ID,
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      },
    });

    const routes = createApprovalRoutes({ approvalDal, policyOverrideDal });
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
    app.route("/", routes);

    const reqBody = {
      decision: "approved",
      mode: "always",
      overrides: [{ tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID }],
    };

    const firstRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    expect(firstRes.status).toBe(200);

    const firstJson = (await firstRes.json()) as { created_overrides?: unknown[] };
    expect(firstJson.created_overrides).toHaveLength(1);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(1);

    const secondRes = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    expect(secondRes.status).toBe(200);

    const secondJson = (await secondRes.json()) as { created_overrides?: unknown[] };
    expect(secondJson.created_overrides).toBeUndefined();
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(1);
  });

  it("does not return an error if policyOverrideDal disappears after approval is persisted", async () => {
    db = openTestSqliteDb();

    let routeDeps: { approvalDal: ApprovalDal; policyOverrideDal?: PolicyOverrideDal };

    class MutatingApprovalDal extends ApprovalDal {
      override async respond(
        input: Parameters<ApprovalDal["respond"]>[0],
      ): Promise<Awaited<ReturnType<ApprovalDal["respond"]>>> {
        const updated = await super.respond(input);
        routeDeps.policyOverrideDal = undefined;
        return updated;
      }
    }

    const approvalDal = new MutatingApprovalDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);

    routeDeps = { approvalDal, policyOverrideDal };

    const created = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "Allow tool.exec?",
      context: {
        policy: {
          agent_id: DEFAULT_AGENT_ID,
          suggested_overrides: [
            { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
          ],
        },
      },
    });

    const routes = createApprovalRoutes(routeDeps);
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
    app.route("/", routes);

    const res = await app.request(`/approvals/${String(created.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [
          { tool_id: "tool.exec", pattern: "echo hi", workspace_id: DEFAULT_WORKSPACE_ID },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      approval: { status: string };
      created_overrides?: unknown[];
    };
    expect(json.approval.status).toBe("approved");
    expect(json.created_overrides).toHaveLength(1);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        toolId: "tool.exec",
      }),
    ).toHaveLength(1);
  });
});
