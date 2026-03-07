import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { join } from "node:path";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createSharedStateConfigRoutes } from "../../src/routes/shared-state-config.js";

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
    createSharedStateConfigRoutes({
      db: container.db,
      identityScopeDal: container.identityScopeDal,
    }),
  );
  return app;
}

describe("shared state config routes", () => {
  let container: GatewayContainer;
  let tenantId: string;
  let app: Hono;

  beforeEach(async () => {
    container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );
    tenantId = await container.identityScopeDal.ensureTenantId("route-tenant");
    app = createApp(container, tenantId);
  });

  afterEach(async () => {
    await container.db.close();
  });

  it("stores and returns shared agent identity revisions", async () => {
    const putRes = await app.request("/config/agents/default/identity", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: {
          meta: { name: "Shared Route Identity", description: "route managed" },
          body: "You are managed via HTTP.",
        },
        reason: "test",
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/config/agents/default/identity");
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as {
      identity: { meta: { name: string } };
      reason: string | null;
    };
    expect(payload.identity.meta.name).toBe("Shared Route Identity");
    expect(payload.reason).toBe("test");
  });

  it("stores and lists shared runtime packages", async () => {
    const putRes = await app.request("/config/runtime-packages/skill/db-skill", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: {
          meta: {
            id: "db-skill",
            name: "DB Skill",
            version: "1.0.0",
            description: "shared package",
          },
          body: "Always use the shared package store first.",
        },
        enabled: true,
        reason: "seed",
      }),
    });
    expect(putRes.status).toBe(200);

    const listRes = await app.request("/config/runtime-packages?kind=skill");
    expect(listRes.status).toBe(200);
    const payload = (await listRes.json()) as {
      packages: Array<{ key: string; enabled: boolean }>;
    };
    expect(payload.packages).toEqual([expect.objectContaining({ key: "db-skill", enabled: true })]);
  });

  it("stores and returns markdown memory docs", async () => {
    const putRes = await app.request("/config/agents/default/markdown-memory/core/MEMORY", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "# MEMORY\n\n## Learned Preferences\n\n- likes tea\n",
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/config/agents/default/markdown-memory/core/MEMORY");
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as { content: string };
    expect(payload.content).toContain("likes tea");
  });
});
