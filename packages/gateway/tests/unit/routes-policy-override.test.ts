import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPolicyOverrideRoutes } from "../../src/routes/policy-override.js";

/**
 * Stub override row returned by mock DAL methods.
 */
function makeOverride(overrides: Record<string, unknown> = {}) {
  return {
    policy_override_id: "ov-1",
    agent_id: "agent-a",
    tool_id: "tool-x",
    pattern: "*.txt",
    workspace_id: null,
    created_by: null,
    expires_at: null,
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("policy override routes", () => {
  function buildApp(dalOverrides: Record<string, unknown> = {}) {
    const mockDal = {
      create: vi.fn(async (opts: Record<string, unknown>) =>
        makeOverride({
          agent_id: opts.agentId,
          tool_id: opts.toolId,
          pattern: opts.pattern,
        }),
      ),
      listAll: vi.fn(async () => [makeOverride()]),
      getById: vi.fn(async () => makeOverride()),
      revoke: vi.fn(async () => true),
      ...dalOverrides,
    };
    const mockPublisher = {
      publish: vi.fn(async () => {}),
    };
    const app = new Hono();
    app.route(
      "/",
      createPolicyOverrideRoutes({
        policyOverrideDal: mockDal,
        eventPublisher: mockPublisher,
      }),
    );
    return { app, mockDal, mockPublisher };
  }

  // ── POST /policy/overrides ─────────────────────────────────

  it("POST /policy/overrides creates override (201)", async () => {
    const { app } = buildApp();
    const res = await app.request("/policy/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent-a",
        tool_id: "tool-x",
        pattern: "*.txt",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent_id: string };
    expect(body.agent_id).toBe("agent-a");
  });

  it("POST /policy/overrides returns 400 when missing required fields", async () => {
    const { app } = buildApp();
    const res = await app.request("/policy/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: "agent-a" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  // ── GET /policy/overrides ──────────────────────────────────

  it("GET /policy/overrides lists all", async () => {
    const { app, mockDal } = buildApp();
    const res = await app.request("/policy/overrides");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overrides: unknown[] };
    expect(body.overrides).toHaveLength(1);
    expect(mockDal.listAll).toHaveBeenCalledWith();
  });

  it("GET /policy/overrides?agent_id=x filters by agent", async () => {
    const { app, mockDal } = buildApp();
    const res = await app.request("/policy/overrides?agent_id=agent-a");
    expect(res.status).toBe(200);
    expect(mockDal.listAll).toHaveBeenCalledWith("agent-a");
  });

  // ── GET /policy/overrides/:id ──────────────────────────────

  it("GET /policy/overrides/:id returns override", async () => {
    const { app } = buildApp();
    const res = await app.request("/policy/overrides/ov-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { policy_override_id: string };
    expect(body.policy_override_id).toBe("ov-1");
  });

  it("GET /policy/overrides/:id returns 404 when not found", async () => {
    const { app } = buildApp({ getById: vi.fn(async () => undefined) });
    const res = await app.request("/policy/overrides/missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── POST /policy/overrides/:id/revoke ──────────────────────

  it("POST /policy/overrides/:id/revoke revokes override", async () => {
    const { app, mockDal } = buildApp();
    const res = await app.request("/policy/overrides/ov-1/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "expired", revoked_by: "admin" }),
    });
    expect(res.status).toBe(200);
    expect(mockDal.revoke).toHaveBeenCalledWith("ov-1", "admin", "expired");
  });

  it("POST /policy/overrides/:id/revoke returns 404 when not found or already revoked", async () => {
    const { app } = buildApp({ revoke: vi.fn(async () => false) });
    const res = await app.request("/policy/overrides/missing/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found_or_already_revoked");
  });
});
