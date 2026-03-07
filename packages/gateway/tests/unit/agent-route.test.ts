import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAgentRoutes } from "../../src/routes/agent.js";

describe("createAgentRoutes", () => {
  it("lists tenant-scoped agents from the db dependency", async () => {
    const all = vi.fn(async () => [
      { agent_key: "default", agent_id: "agent-default" },
      { agent_key: "helper", agent_id: "agent-helper" },
    ]);
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
    app.route(
      "/",
      createAgentRoutes({
        agents: {
          getRuntime: vi.fn(),
          listDiscoveredAgentKeys: vi.fn(async () => ["default", "helper"]),
        } as never,
        db: { all } as never,
      }),
    );

    const res = await app.request("/agent/list?include_default=false");

    expect(res.status).toBe(200);
    expect(all).toHaveBeenCalledWith(expect.stringContaining("FROM agents"), ["tenant-1"]);
    expect(await res.json()).toEqual({
      agents: [{ agent_key: "helper", agent_id: "agent-helper" }],
    });
  });

  it("includes default and filesystem-discovered agents even before db rows exist", async () => {
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
    app.route(
      "/",
      createAgentRoutes({
        agents: {
          getRuntime: vi.fn(),
          listDiscoveredAgentKeys: vi.fn(async () => ["default", "helper"]),
        } as never,
        db: { all: vi.fn(async () => []) } as never,
      }),
    );

    const res = await app.request("/agent/list");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agents: [{ agent_key: "default" }, { agent_key: "helper" }],
    });
  });
});
