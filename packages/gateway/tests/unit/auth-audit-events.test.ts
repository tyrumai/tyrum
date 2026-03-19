import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { WsEventEnvelope } from "@tyrum/contracts";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { EventLog } from "../../src/modules/planner/event-log.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { AuthAudit, GATEWAY_AUTH_AUDIT_PLAN_ID } from "../../src/modules/auth/audit.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { createWsHandler } from "../../src/routes/ws.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

async function getAuthAuditPlanId(db: SqliteDb): Promise<string> {
  const row = await db.get<{ plan_id: string }>(
    "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_key = ?",
    [DEFAULT_TENANT_ID, GATEWAY_AUTH_AUDIT_PLAN_ID],
  );
  if (!row) throw new Error("expected auth audit plan row to exist");
  return row.plan_id;
}

describe("auth audit events", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("records auth.failed without leaking query tokens", async () => {
    const eventLog = new EventLog(db);
    const secret = "super-secret-query-token";
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
      failedAuthWindowMs: 10_000,
    });

    const authTokens = { authenticate: async () => null } as unknown as AuthTokenService;

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("clientIp", "203.0.113.10");
      await next();
    });
    app.use("*", createAuthMiddleware(authTokens, { audit }));
    app.get("/api/data", (c) => c.json({ ok: true }));

    const res = await app.request(`/api/data?token=${encodeURIComponent(secret)}`);
    expect(res.status).toBe(401);

    const planId = await getAuthAuditPlanId(db);
    const rows = await db.all<{ action_json: string }>(
      "SELECT action_json FROM planner_events WHERE tenant_id = ? AND plan_id = ? ORDER BY step_index ASC",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_json).not.toContain(secret);

    // Without a known tenant_id (missing token), auth failures are persisted to the audit log
    // but are not broadcast over WS.
    const outbox = await db.get<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC LIMIT 1",
      ["ws.broadcast"],
    );
    expect(outbox).toBeUndefined();
  });

  it("rate-limits repeated auth failures by client IP", async () => {
    const eventLog = new EventLog(db);
    let nowMs = 0;
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => nowMs,
      failedAuthWindowMs: 10_000,
    });

    const authTokens = { authenticate: async () => null } as unknown as AuthTokenService;

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("clientIp", "203.0.113.10");
      await next();
    });
    app.use("*", createAuthMiddleware(authTokens, { audit }));
    app.get("/api/data", (c) => c.json({ ok: true }));

    expect((await app.request("/api/data")).status).toBe(401);
    expect((await app.request("/api/data")).status).toBe(401);

    const planId = await getAuthAuditPlanId(db);
    const rowsAfterBurst = await db.all<{ step_index: number }>(
      "SELECT step_index FROM planner_events WHERE tenant_id = ? AND plan_id = ?",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rowsAfterBurst).toHaveLength(1);

    nowMs = 20_000;
    expect((await app.request("/api/data")).status).toBe(401);

    const rowsAfterWindow = await db.all<{ step_index: number }>(
      "SELECT step_index FROM planner_events WHERE tenant_id = ? AND plan_id = ?",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rowsAfterWindow).toHaveLength(2);
  });

  it("bounds failed-auth rate limiter key cardinality", async () => {
    const eventLog = new EventLog(db);
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
      failedAuthWindowMs: 10_000,
      failedAuthMaxKeys: 2,
    } as unknown as ConstructorParameters<typeof AuthAudit>[0]);

    await audit.recordAuthFailed({
      surface: "http",
      reason: "missing_token",
      token_transport: "missing",
      client_ip: "203.0.113.1",
    });
    await audit.recordAuthFailed({
      surface: "http",
      reason: "missing_token",
      token_transport: "missing",
      client_ip: "203.0.113.2",
    });
    await audit.recordAuthFailed({
      surface: "http",
      reason: "missing_token",
      token_transport: "missing",
      client_ip: "203.0.113.3",
    });

    const limiter = (audit as unknown as { failedAuthLimiter: unknown }).failedAuthLimiter as {
      nextAllowedAtByKey: Map<string, number>;
    };
    expect(limiter.nextAllowedAtByKey.size).toBeLessThanOrEqual(2);
  });

  it("records authz.denied when a scoped token lacks required scope", async () => {
    const eventLog = new EventLog(db);
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
    });

    const authTokens = new AuthTokenService(db);
    const deviceToken = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "client",
      deviceId: "dev_client_1",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const app = new Hono();
    app.use("*", createAuthMiddleware(authTokens, { audit }));
    app.use("*", createHttpScopeAuthorizationMiddleware({ audit }));
    app.post("/watchers", (c) => c.json({ ok: true }));

    const res = await app.request("/watchers", {
      method: "POST",
      headers: { Authorization: `Bearer ${deviceToken.token}` },
    });
    expect(res.status).toBe(403);

    const planId = await getAuthAuditPlanId(db);
    const rows = await db.all<{ action_json: string }>(
      "SELECT action_json FROM planner_events WHERE tenant_id = ? AND plan_id = ? ORDER BY step_index ASC",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rows).toHaveLength(1);

    const action = JSON.parse(rows[0]!.action_json) as Record<string, unknown>;
    expect(action["type"]).toBe("authz.denied");
    expect(action["required_scopes"]).toEqual(["operator.write"]);
  });

  it("records authz.denied for WS approval.list when scoped token lacks operator.read", async () => {
    const eventLog = new EventLog(db);
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
    });

    const cm = new ConnectionManager();
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(() => undefined as never),
      readyState: 1,
    };
    const clientId = cm.addClient(
      ws as never,
      ["playwright"] as never,
      {
        role: "client",
        deviceId: "dev_client_1",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-1",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          device_id: "dev_client_1",
          scopes: [],
        },
      } as never,
    );
    const client = cm.getClient(clientId)!;

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-123",
        type: "approval.list",
        payload: {},
      }),
      { connectionManager: cm, authAudit: audit },
    );
    expect(result).toBeDefined();

    const planId = await getAuthAuditPlanId(db);
    const rows = await db.all<{ action_json: string }>(
      "SELECT action_json FROM planner_events WHERE tenant_id = ? AND plan_id = ? ORDER BY step_index ASC",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rows).toHaveLength(1);

    const action = JSON.parse(rows[0]!.action_json) as Record<string, unknown>;
    expect(action["type"]).toBe("authz.denied");
    expect(action["surface"]).toBe("ws");
    expect(action["reason"]).toBe("insufficient_scope");
    expect(action["required_scopes"]).toEqual(["operator.read"]);

    const outbox = await db.get<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC LIMIT 1",
      ["ws.broadcast"],
    );
    expect(outbox).toBeDefined();
    const payload = JSON.parse(outbox!.payload_json) as { message?: { type?: string } };
    const parsedEvent = WsEventEnvelope.safeParse(payload.message);
    expect(parsedEvent.success).toBe(true);
    if (parsedEvent.success) {
      expect(parsedEvent.data.type).toBe("authz.denied");
    }
  });

  it("records authz.denied for WS requests when scoped token lacks required scope", async () => {
    const eventLog = new EventLog(db);
    const audit = new AuthAudit({
      eventLog,
      nowMs: () => 0,
    });

    const cm = new ConnectionManager();
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(() => undefined as never),
      readyState: 1,
    };
    const clientId = cm.addClient(
      ws as never,
      ["playwright"] as never,
      {
        role: "client",
        deviceId: "dev_client_1",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-2",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          device_id: "dev_client_1",
          scopes: ["operator.read"],
        },
      } as never,
    );
    const client = cm.getClient(clientId)!;

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "command.execute",
        payload: { command: "/help" },
      }),
      { connectionManager: cm, authAudit: audit },
    );
    expect(result).toBeDefined();
    expect((result as unknown as { ok?: boolean }).ok).toBe(false);

    const planId = await getAuthAuditPlanId(db);
    const rows = await db.all<{ action_json: string }>(
      "SELECT action_json FROM planner_events WHERE tenant_id = ? AND plan_id = ? ORDER BY step_index ASC",
      [DEFAULT_TENANT_ID, planId],
    );
    expect(rows).toHaveLength(1);

    const action = JSON.parse(rows[0]!.action_json) as Record<string, unknown>;
    expect(action["type"]).toBe("authz.denied");
    expect(action["surface"]).toBe("ws");
    expect(action["reason"]).toBe("insufficient_scope");
    expect(action["required_scopes"]).toEqual(["operator.admin"]);
  });

  it("awaits WS authz audit persistence before returning a forbidden response", async () => {
    const cm = new ConnectionManager();
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(() => undefined as never),
      readyState: 1,
    };
    const clientId = cm.addClient(
      ws as never,
      ["playwright"] as never,
      {
        role: "client",
        deviceId: "dev_client_1",
        protocolRev: 2,
        authClaims: {
          token_kind: "device",
          token_id: "token-3",
          tenant_id: DEFAULT_TENANT_ID,
          role: "client",
          device_id: "dev_client_1",
          scopes: ["operator.read"],
        },
      } as never,
    );
    const client = cm.getClient(clientId)!;

    let auditCompleted = false;
    const audit = {
      recordAuthzDenied: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        auditCompleted = true;
      },
    } as unknown as AuthAudit;

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "command.execute",
        payload: { command: "/help" },
      }),
      { connectionManager: cm, authAudit: audit },
    );

    expect((result as unknown as { ok?: boolean }).ok).toBe(false);
    expect(auditCompleted).toBe(true);
  });

  it("awaits auth.failed persistence before closing WS upgrade for unauthorized clients", async () => {
    const authTokens = new AuthTokenService(db);

    let resolveAudit: (() => void) | undefined;
    const auditPromise = new Promise<void>((resolve) => {
      resolveAudit = resolve;
    });
    const authAudit = {
      recordAuthFailed: vi.fn(async () => auditPromise),
    } as unknown as AuthAudit;

    const cm = new ConnectionManager();
    const { wss, stopHeartbeat } = createWsHandler({
      connectionManager: cm,
      authTokens,
      protocolDeps: { connectionManager: cm, authAudit },
    });

    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(() => undefined as never),
      once: vi.fn(() => undefined as never),
      readyState: 1,
    };

    const req = {
      method: "GET",
      url: "/ws",
      headers: {},
      socket: { remoteAddress: "203.0.113.10" },
    } as never;

    wss.emit("connection", ws as never, req);

    await Promise.resolve();
    expect(authAudit.recordAuthFailed).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();

    resolveAudit?.();
    await auditPromise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(ws.close).toHaveBeenCalledWith(4001, "unauthorized");
    stopHeartbeat();
  });
});
