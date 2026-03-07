import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createPluginRoutes } from "../../src/routes/plugins.js";

function authClaims() {
  return {
    token_kind: "admin" as const,
    token_id: "test-token",
    tenant_id: DEFAULT_TENANT_ID,
    role: "admin" as const,
    scopes: ["*"],
    issued_at: new Date(0).toISOString(),
  };
}

describe("plugin routes", () => {
  it("uses the tenant plugin catalog for inventory and rpc dispatch", async () => {
    const router = new Hono();
    router.get("/ping", (c) => c.json({ ok: true, source: "tenant-router" }));

    const loadTenantRegistry = vi.fn(async () => ({
      list: () => [
        {
          id: "echo",
          name: "Echo",
          version: "0.0.1",
          loaded_at: new Date(0).toISOString(),
          source_dir: "/tmp/echo",
        },
      ],
      getManifest: (pluginId: string) =>
        pluginId === "echo"
          ? {
              id: "echo",
              name: "Echo",
              version: "0.0.1",
              entry: "index.mjs",
              contributes: {
                tools: [],
                commands: [],
                routes: ["/ping"],
                mcp_servers: [],
              },
              permissions: {
                tools: [],
                network_egress: [],
                secrets: [],
                db: false,
              },
              config_schema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            }
          : undefined,
      getRouter: (pluginId: string) => (pluginId === "echo" ? router : undefined),
    }));

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", authClaims());
      await next();
    });
    app.route(
      "/",
      createPluginRoutes({
        pluginCatalogProvider: {
          loadGlobalRegistry: vi.fn(),
          loadTenantRegistry,
          invalidateTenantRegistry: vi.fn(async () => undefined),
          shutdown: vi.fn(async () => undefined),
        } as never,
      }),
    );

    const listRes = await app.request("/plugins");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      status: "ok",
      plugins: [
        {
          id: "echo",
          loaded_at: new Date(0).toISOString(),
          name: "Echo",
          source_dir: "/tmp/echo",
          version: "0.0.1",
        },
      ],
    });

    const rpcRes = await app.request("/plugins/echo/rpc/ping");
    expect(rpcRes.status).toBe(200);
    expect(await rpcRes.json()).toEqual({ ok: true, source: "tenant-router" });
    expect(loadTenantRegistry).toHaveBeenCalledWith(DEFAULT_TENANT_ID);
  });

  it("falls back to the global plugin registry when auth is disabled", async () => {
    const router = new Hono();
    router.get("/ping", (c) => c.json({ ok: true, source: "global-router" }));

    const loadGlobalRegistry = vi.fn(async () => ({
      list: () => [
        {
          id: "echo",
          name: "Echo",
          version: "0.0.1",
          loaded_at: new Date(0).toISOString(),
          source_dir: "/tmp/echo",
        },
      ],
      getManifest: (pluginId: string) =>
        pluginId === "echo"
          ? {
              id: "echo",
              name: "Echo",
              version: "0.0.1",
              entry: "index.mjs",
              contributes: {
                tools: [],
                commands: [],
                routes: ["/ping"],
                mcp_servers: [],
              },
              permissions: {
                tools: [],
                network_egress: [],
                secrets: [],
                db: false,
              },
              config_schema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            }
          : undefined,
      getRouter: (pluginId: string) => (pluginId === "echo" ? router : undefined),
    }));

    const app = new Hono();
    app.route(
      "/",
      createPluginRoutes({
        pluginCatalogProvider: {
          loadGlobalRegistry,
          loadTenantRegistry: vi.fn(),
          invalidateTenantRegistry: vi.fn(async () => undefined),
          shutdown: vi.fn(async () => undefined),
        },
      }),
    );

    const listRes = await app.request("/plugins");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      status: "ok",
      plugins: [
        {
          id: "echo",
          loaded_at: new Date(0).toISOString(),
          name: "Echo",
          source_dir: "/tmp/echo",
          version: "0.0.1",
        },
      ],
    });

    const rpcRes = await app.request("/plugins/echo/rpc/ping");
    expect(rpcRes.status).toBe(200);
    expect(await rpcRes.json()).toEqual({ ok: true, source: "global-router" });
    expect(loadGlobalRegistry).toHaveBeenCalledTimes(2);
  });
});
