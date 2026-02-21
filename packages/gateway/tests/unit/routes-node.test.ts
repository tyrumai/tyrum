import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createNodeRoutes } from "../../src/routes/node.js";

/**
 * Stub NodeRow returned by mock DAL methods.
 */
function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    node_id: "n-1",
    label: "edge-01",
    status: "pending",
    capabilities: ["compute"],
    metadata: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("node routes", () => {
  function buildApp(dalOverrides: Record<string, unknown> = {}) {
    const mockNodeDal = {
      listNodes: vi.fn(async () => [makeNode()]),
      getById: vi.fn(async () => makeNode()),
      createPairingRequest: vi.fn(
        async (nodeId: string, label?: string, capabilities?: string[], metadata?: unknown) =>
          makeNode({ node_id: nodeId, label, capabilities, metadata }),
      ),
      resolvePairing: vi.fn(async () => makeNode({ status: "approved" })),
      revokeNode: vi.fn(async () => makeNode({ status: "revoked" })),
      ...dalOverrides,
    };
    const app = new Hono();
    app.route("/", createNodeRoutes({ nodeDal: mockNodeDal }));
    return { app, mockNodeDal };
  }

  // ── GET /nodes ──────────────────────────────────────────────

  it("GET /nodes returns list of nodes", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[] };
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0]).toMatchObject({ node_id: "n-1" });
  });

  it("GET /nodes?status=pending filters by status", async () => {
    const { app, mockNodeDal } = buildApp();
    const res = await app.request("/nodes?status=pending");
    expect(res.status).toBe(200);
    expect(mockNodeDal.listNodes).toHaveBeenCalledWith("pending");
  });

  it("GET /nodes?status=invalid returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes?status=invalid");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  // ── GET /nodes/:id ─────────────────────────────────────────

  it("GET /nodes/:id returns node", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes/n-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node: { node_id: string } };
    expect(body.node.node_id).toBe("n-1");
  });

  it("GET /nodes/:id returns 404 when not found", async () => {
    const { app } = buildApp({ getById: vi.fn(async () => undefined) });
    const res = await app.request("/nodes/missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── POST /nodes ────────────────────────────────────────────

  it("POST /nodes creates pairing request (201)", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: "n-new", label: "lab-1" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { node: { node_id: string } };
    expect(body.node.node_id).toBe("n-new");
  });

  it("POST /nodes returns 400 when node_id missing", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "no-id" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  // ── POST /nodes/:id/pair ───────────────────────────────────

  it("POST /nodes/:id/pair resolves pairing (approved)", async () => {
    const { app, mockNodeDal } = buildApp();
    const res = await app.request("/nodes/n-1/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", resolved_by: "admin" }),
    });
    expect(res.status).toBe(200);
    expect(mockNodeDal.resolvePairing).toHaveBeenCalledWith(
      "n-1",
      "approved",
      "admin",
      undefined,
    );
    const body = (await res.json()) as { node: { status: string } };
    expect(body.node.status).toBe("approved");
  });

  it("POST /nodes/:id/pair returns 400 for invalid decision", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes/n-1/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "maybe" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("POST /nodes/:id/pair returns 404 when node not found", async () => {
    const { app } = buildApp({
      resolvePairing: vi.fn(async () => undefined),
    });
    const res = await app.request("/nodes/missing/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  // ── DELETE /nodes/:id ──────────────────────────────────────

  it("DELETE /nodes/:id revokes node", async () => {
    const { app } = buildApp();
    const res = await app.request("/nodes/n-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node: { status: string } };
    expect(body.node.status).toBe("revoked");
  });

  it("DELETE /nodes/:id returns 404 when not found", async () => {
    const { app } = buildApp({ revokeNode: vi.fn(async () => undefined) });
    const res = await app.request("/nodes/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
