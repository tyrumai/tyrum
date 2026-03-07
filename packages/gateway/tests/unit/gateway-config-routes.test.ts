import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { LifecycleHookConfigDal } from "../../src/modules/hooks/config-dal.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { createGatewayConfigRoutes } from "../../src/routes/gateway-config.js";

const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");

function createApp(container: GatewayContainer, tenantId: string): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "tenant",
      token_id: "tenant-token-1",
      tenant_id: tenantId,
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route(
    "/",
    createGatewayConfigRoutes({
      db: container.db,
      identityScopeDal: container.identityScopeDal,
      hooksDal: new LifecycleHookConfigDal(container.db),
      policyBundleDal: new PolicyBundleConfigDal(container.db),
    }),
  );
  return app;
}

describe("gateway config routes", () => {
  let container: GatewayContainer;
  let tenantId: string;
  let app: Hono;

  beforeEach(async () => {
    container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
    tenantId = await container.identityScopeDal.ensureTenantId("gateway-config-tenant");
    app = createApp(container, tenantId);
  });

  afterEach(async () => {
    await container.db.close();
  });

  it("stores and returns lifecycle hooks", async () => {
    const putRes = await app.request("/config/hooks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hooks: [
          {
            hook_key: "hook:11111111-1111-4111-8111-111111111111",
            event: "gateway.start",
            lane: "cron",
            steps: [
              {
                type: "CLI",
                args: {
                  cmd: "echo",
                  args: ["started"],
                },
              },
            ],
          },
        ],
        reason: "seed",
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/config/hooks");
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as { hooks: Array<{ event: string }> };
    expect(payload.hooks).toEqual([expect.objectContaining({ event: "gateway.start" })]);
  });

  it("stores deployment and agent policy bundle configs", async () => {
    const deploymentRes = await app.request("/config/policy/deployment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          v: 1,
          tools: { default: "deny", allow: ["tool.exec"], require_approval: [], deny: [] },
        },
        reason: "deployment",
      }),
    });
    expect(deploymentRes.status).toBe(200);

    const agentRes = await app.request("/config/policy/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bundle: {
          v: 1,
          tools: { default: "deny", allow: [], require_approval: ["tool.exec"], deny: [] },
        },
        reason: "agent",
      }),
    });
    expect(agentRes.status).toBe(200);

    const getDeployment = await app.request("/config/policy/deployment");
    expect(getDeployment.status).toBe(200);
    const deploymentPayload = (await getDeployment.json()) as {
      bundle: { tools?: { allow?: string[] } };
    };
    expect(deploymentPayload.bundle.tools?.allow).toEqual(["tool.exec"]);

    const getAgent = await app.request("/config/policy/agents/default");
    expect(getAgent.status).toBe(200);
    const agentPayload = (await getAgent.json()) as {
      agent_key: string | null;
      bundle: { tools?: { require_approval?: string[] } };
    };
    expect(agentPayload.agent_key).toBe("default");
    expect(agentPayload.bundle.tools?.require_approval).toEqual(["tool.exec"]);
  });

  it("does not create agents when reading a missing agent policy bundle", async () => {
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const getRes = await app.request("/config/policy/agents/typo-agent");
    expect(getRes.status).toBe(404);

    const revisionsRes = await app.request("/config/policy/agents/typo-agent/revisions");
    expect(revisionsRes.status).toBe(404);

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);
  });
});
