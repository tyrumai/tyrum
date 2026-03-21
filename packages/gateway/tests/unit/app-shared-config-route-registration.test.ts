import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { join } from "node:path";
import { createContainer } from "../../src/container.js";
import {
  createAppRouteDependencies,
  registerAgentsAndWorkspaceRoutes,
} from "../../src/app-route-registrars.js";

const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");

async function buildApp(stateMode: "local" | "shared") {
  const container = createContainer(
    { dbPath: ":memory:", migrationsDir },
    { deploymentConfig: { state: { mode: stateMode } } },
  );
  const tenantId = await container.identityScopeDal.ensureTenantId(`tenant-${stateMode}`);
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

  registerAgentsAndWorkspaceRoutes({
    app,
    container,
    opts: {},
    runtime: {
      version: "test",
      instanceId: "gw-test",
      role: "all",
      otelEnabled: false,
    },
    isLocalOnly: true,
    wsMaxBufferedBytes: 1024,
    channelPipelineEnabled: true,
    engine: undefined,
    secretProviderForTenant: undefined,
    routeDeps: createAppRouteDependencies(container),
  });

  return { app, container };
}

describe("shared config route registration", () => {
  const containers: Array<{ db: { close: () => Promise<void> } }> = [];

  afterEach(async () => {
    while (containers.length > 0) {
      const container = containers.pop();
      if (container) {
        await container.db.close();
      }
    }
  });

  it("does not mount shared-state config routes in local mode", async () => {
    const { app, container } = await buildApp("local");
    containers.push(container);

    const hooksRes = await app.request("/config/hooks");
    const policyRes = await app.request("/config/policy/deployment");
    const sharedStateRes = await app.request("/config/runtime-packages?kind=skill");

    expect(hooksRes.status).toBe(404);
    expect(policyRes.status).toBe(404);
    expect(sharedStateRes.status).toBe(404);
  });

  it("mounts shared-state config routes in shared mode", async () => {
    const { app, container } = await buildApp("shared");
    containers.push(container);

    const hooksRes = await app.request("/config/hooks");
    const policyRes = await app.request("/config/policy/deployment");
    const sharedStateRes = await app.request("/config/runtime-packages?kind=skill");

    expect(hooksRes.status).toBe(200);
    expect(policyRes.status).toBe(404);
    expect(sharedStateRes.status).toBe(200);
  });
});
