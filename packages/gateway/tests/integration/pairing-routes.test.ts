import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { NodePairingDal } from "../../src/modules/node/pairing-dal.js";
import { createPairingRoutes } from "../../src/routes/pairing.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";

interface MockWebSocket {
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
  terminate: ReturnType<typeof vi.fn>;
}

function createMockWs(options?: { bufferedAmount?: number; readyState?: number }): MockWebSocket {
  return {
    bufferedAmount: options?.bufferedAmount ?? 0,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: options?.readyState ?? 1,
    terminate: vi.fn(),
  };
}

describe("Pairing routes", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let nodePairingDal: NodePairingDal;
  let app: Hono;
  const tenantId = DEFAULT_TENANT_ID;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    nodePairingDal = new NodePairingDal(db);
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: tenantId,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route("/", createPairingRoutes({ nodePairingDal }));
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  async function seedAwaitingHumanPairing(): Promise<number> {
    const pairing = await nodePairingDal.upsertOnConnect({
      tenantId,
      nodeId: "node-1",
      pubkey: "pubkey-1",
      label: "node-1",
      capabilities: ["cli"],
      motivation: "Human review is required before this node can be paired.",
      initialStatus: "awaiting_human",
      nowIso: "2026-02-23T00:00:00.000Z",
    });
    expect(pairing.status).toBe("awaiting_human");
    expect(pairing.motivation).toBe("Human review is required before this node can be paired.");
    return pairing.pairing_id;
  }

  it("rejects approve when trust_level is missing", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects approve when capability_allowlist is missing", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_request");
  });

  it("allows approving with an explicitly empty capability_allowlist", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: { status?: string; capability_allowlist?: unknown[] };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.status).toBe("approved");
    expect(body.pairing?.capability_allowlist).toEqual([]);
  });

  it("gets a single pairing with full review history", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    await nodePairingDal.transitionWithReview({
      tenantId,
      pairingId,
      status: "awaiting_human",
      reviewerKind: "guardian",
      reviewState: "requested_human",
      reason: "A human should verify the node trust assumptions.",
      allowedCurrentStatuses: ["awaiting_human"],
    });

    const res = await app.request(`/pairings/${String(pairingId)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      pairing?: {
        pairing_id?: number;
        motivation?: string;
        reviews?: Array<{ state?: string; reason?: string | null }>;
      };
    };
    expect(body.status).toBe("ok");
    expect(body.pairing?.pairing_id).toBe(pairingId);
    expect(body.pairing?.motivation).toBe(
      "Human review is required before this node can be paired.",
    );
    expect(body.pairing?.reviews).toEqual([
      expect.objectContaining({
        state: "requested_human",
        reason: "A human should verify the node trust assumptions.",
      }),
    ]);
  });

  it("rejects approving with a legacy umbrella capability descriptor", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [{ id: "tyrum.desktop", version: "1.0.0" }],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("legacy umbrella capability 'tyrum.desktop'");
  });

  it("rejects approve when capability_allowlist contains a legacy umbrella descriptor", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [{ id: "tyrum.desktop", version: "1.0.0" }],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("invalid_request");
    expect(body.message).toContain("legacy umbrella capability");
  });

  it("does not return scoped_token in the approve response body", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const res = await app.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, "scoped_token")).toBe(false);
  });

  it("evicts slow websocket consumers during pairing approval delivery", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const connectionManager = new ConnectionManager();
    const slowNodeWs = createMockWs({ bufferedAmount: 11 });
    const healthyClientWs = createMockWs();
    const logger = { warn: vi.fn() };

    connectionManager.addClient(slowNodeWs as never, ["cli"] as never, {
      id: "slow-node",
      role: "node",
      deviceId: "node-1",
      authClaims: {
        token_kind: "device",
        token_id: "token-node",
        tenant_id: tenantId,
        role: "node",
        device_id: "node-1",
        scopes: ["*"],
      },
    });
    connectionManager.addClient(healthyClientWs as never, ["cli"] as never, {
      id: "healthy-client",
      role: "client",
      authClaims: {
        token_kind: "admin",
        token_id: "token-client",
        tenant_id: tenantId,
        role: "admin",
        scopes: ["*"],
      },
    });

    const wsApp = new Hono();
    wsApp.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: tenantId,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    wsApp.route(
      "/",
      createPairingRoutes({
        logger: logger as never,
        nodePairingDal,
        ws: { connectionManager, maxBufferedBytes: 10 },
      }),
    );

    const res = await wsApp.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(slowNodeWs.send).not.toHaveBeenCalled();
    expect(slowNodeWs.close).toHaveBeenCalledWith(1013, "slow consumer");
    expect(connectionManager.getClient("slow-node")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "ws.slow_consumer_evicted",
      expect.objectContaining({
        delivery_mode: "local_direct",
        node_id: "node-1",
        peer_id: "slow-node",
        topic: "pairing.updated",
      }),
    );
    expect(healthyClientWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(healthyClientWs.send.mock.calls[0]?.[0] ?? "{}"))).toMatchObject({
      type: "pairing.updated",
    });
  });

  it("does not deliver pairing.approved to nodes without a tenant claim", async () => {
    const pairingId = await seedAwaitingHumanPairing();
    const connectionManager = new ConnectionManager();
    const unscopedNodeWs = createMockWs();

    connectionManager.addClient(unscopedNodeWs as never, ["cli"] as never, {
      id: "unscoped-node",
      role: "node",
      deviceId: "node-1",
      authClaims: {
        token_kind: "device",
        token_id: "token-node",
        tenant_id: undefined,
        role: "node",
        device_id: "node-1",
        scopes: ["*"],
      },
    });

    const wsApp = new Hono();
    wsApp.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: tenantId,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    wsApp.route(
      "/",
      createPairingRoutes({
        nodePairingDal,
        ws: { connectionManager },
      }),
    );

    const res = await wsApp.request(`/pairings/${String(pairingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "ok",
        trust_level: "remote",
        capability_allowlist: [],
      }),
    });

    expect(res.status).toBe(200);
    expect(unscopedNodeWs.send).not.toHaveBeenCalled();
  });
});
