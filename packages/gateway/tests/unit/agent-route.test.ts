import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAgentRoutes } from "../../src/routes/agent.js";
import { ScopeNotFoundError } from "../../src/modules/identity/scope.js";

function createAuthedApp(deps: Parameters<typeof createAgentRoutes>[0]) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "token-1",
      tenant_id: "tenant-1",
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route("/", createAgentRoutes(deps));
  return app;
}

describe("createAgentRoutes", () => {
  it("lists tenant-scoped agents from the db dependency", async () => {
    const all = vi.fn(async () => [
      {
        agent_key: "default",
        agent_id: "11111111-1111-4111-8111-111111111111",
        is_primary: 1,
      },
      { agent_key: "helper", agent_id: "22222222-2222-4222-8222-222222222222", is_primary: 0 },
    ]);
    const app = createAuthedApp({
      agents: {
        getRuntime: vi.fn(),
        listDiscoveredAgentKeys: vi.fn(async () => ["default", "helper"]),
        resolveAgentHome: vi.fn(() => "/tmp/agent-home"),
      } as never,
      db: { all } as never,
    });

    const res = await app.request("/agent/list?include_default=false");

    expect(res.status).toBe(200);
    expect(all).toHaveBeenNthCalledWith(1, expect.stringContaining("FROM agents"), ["tenant-1"]);
    expect(await res.json()).toEqual({
      agents: [
        {
          agent_key: "helper",
          agent_id: "22222222-2222-4222-8222-222222222222",
          has_config: false,
          is_primary: false,
          persona: {
            name: "Helper",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
        },
      ],
    });
  });

  it("returns only managed db-backed agents from /agent/list", async () => {
    const app = createAuthedApp({
      agents: {
        getRuntime: vi.fn(),
        listDiscoveredAgentKeys: vi.fn(async () => ["default", "helper"]),
        resolveAgentHome: vi.fn(() => "/tmp/agent-home"),
      } as never,
      db: { all: vi.fn(async () => []) } as never,
    });

    const res = await app.request("/agent/list");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: [] });
  });

  it("uses the primary agent for /agent/status when no agent_key is provided", async () => {
    const status = vi.fn(async () => ({ ok: true }));
    const getRuntime = vi.fn(async () => ({ status }));
    const app = createAuthedApp({
      agents: { getRuntime } as never,
      db: {
        get: vi.fn(async (sql: string) => {
          if (sql.includes("is_primary = TRUE")) {
            return {
              agent_id: "11111111-1111-4111-8111-111111111111",
              agent_key: "primary-agent",
              is_primary: 1,
            };
          }
          return undefined;
        }),
      } as never,
    });

    const res = await app.request("/agent/status");

    expect(res.status).toBe(200);
    expect(getRuntime).toHaveBeenCalledWith({ tenantId: "tenant-1", agentKey: "primary-agent" });
    expect(status).toHaveBeenCalledWith(true);
  });

  it("returns route-level validation errors for invalid or missing status requests", async () => {
    const db = {
      get: vi.fn(async (_sql: string, params?: unknown[]) => {
        const agentKey = Array.isArray(params) ? params[1] : undefined;
        if (agentKey === "missing") {
          return undefined;
        }
        return undefined;
      }),
    };
    const app = createAuthedApp({
      agents: { getRuntime: vi.fn() } as never,
      db: db as never,
    });

    const invalidRes = await app.request("/agent/status?agent_key=%20%20");
    const missingRes = await app.request("/agent/status?agent_key=missing");

    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({
      error: "invalid_request",
      message: "agent_key must be a non-empty string",
    });
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toEqual({
      error: "not_found",
      message: "agent 'missing' not found",
    });
  });

  it("returns a primary-agent not found message when /agent/status has no explicit agent key", async () => {
    const app = createAuthedApp({
      agents: { getRuntime: vi.fn() } as never,
      db: { get: vi.fn(async () => undefined) } as never,
    });

    const res = await app.request("/agent/status");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "primary agent not found",
    });
  });

  it("maps runtime lookup and status scope errors on /agent/status", async () => {
    const getRuntime = vi
      .fn(async (_input: { tenantId: string; agentKey: string }) => ({
        status: vi.fn(async () => {
          throw new ScopeNotFoundError("primary agent not found");
        }),
      }))
      .mockRejectedValueOnce(new Error("unknown agent"));
    const app = createAuthedApp({
      agents: { getRuntime } as never,
      db: {
        get: vi.fn(async () => ({
          agent_id: "11111111-1111-4111-8111-111111111111",
          agent_key: "primary-agent",
          is_primary: 1,
        })),
      } as never,
    });

    const runtimeErrorRes = await app.request("/agent/status");
    const scopeErrorRes = await app.request("/agent/status");

    expect(runtimeErrorRes.status).toBe(400);
    expect(await runtimeErrorRes.json()).toEqual({
      error: "invalid_request",
      message: "unknown agent",
    });
    expect(scopeErrorRes.status).toBe(404);
    expect(await scopeErrorRes.json()).toEqual({
      error: "not_found",
      message: "primary agent not found",
    });
  });

  it("returns validation and runtime errors from /agent/turn", async () => {
    const turn = vi
      .fn(async () => ({ ok: true }))
      .mockRejectedValueOnce(new Error("turn exploded"));
    const getRuntime = vi
      .fn(async () => ({ turn }))
      .mockRejectedValueOnce(new Error("unknown agent"));
    const db = {
      get: vi.fn(async (_sql: string, params?: unknown[]) => {
        const agentKey = Array.isArray(params) ? params[1] : undefined;
        if (agentKey === "missing") {
          return undefined;
        }
        return {
          agent_id: "11111111-1111-4111-8111-111111111111",
          agent_key: "primary-agent",
          is_primary: 1,
        };
      }),
    };
    const app = createAuthedApp({
      agents: { getRuntime } as never,
      db: db as never,
    });

    const invalidRes = await app.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify({ channel: "web" }),
      headers: { "content-type": "application/json" },
    });
    const missingRes = await app.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify({
        agent_key: "missing",
        channel: "web",
        thread_id: "thread-1",
        parts: [{ type: "text", text: "hello" }],
      }),
      headers: { "content-type": "application/json" },
    });
    const runtimeLookupRes = await app.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify({
        channel: "web",
        thread_id: "thread-1",
        parts: [{ type: "text", text: "hello" }],
      }),
      headers: { "content-type": "application/json" },
    });
    const runtimeTurnRes = await app.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify({
        channel: "web",
        thread_id: "thread-1",
        parts: [{ type: "text", text: "hello" }],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(invalidRes.status).toBe(400);
    expect(missingRes.status).toBe(404);
    expect(await missingRes.json()).toEqual({
      error: "not_found",
      message: "agent 'missing' not found",
    });
    expect(runtimeLookupRes.status).toBe(400);
    expect(await runtimeLookupRes.json()).toEqual({
      error: "invalid_request",
      message: "unknown agent",
    });
    expect(runtimeTurnRes.status).toBe(502);
    expect(await runtimeTurnRes.json()).toEqual({
      error: "agent_runtime_error",
      message: "turn exploded",
    });
  });

  it("returns a primary-agent not found message when /agent/turn omits agent_key", async () => {
    const app = createAuthedApp({
      agents: { getRuntime: vi.fn() } as never,
      db: { get: vi.fn(async () => undefined) } as never,
    });

    const res = await app.request("/agent/turn", {
      method: "POST",
      body: JSON.stringify({
        channel: "web",
        thread_id: "thread-1",
        parts: [{ type: "text", text: "hello" }],
      }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "primary agent not found",
    });
  });
});
