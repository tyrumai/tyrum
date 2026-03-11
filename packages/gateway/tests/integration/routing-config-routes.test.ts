import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createRoutingConfigRoutes } from "../../src/routes/routing-config.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import {
  DEFAULT_AGENT_KEY,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_KEY,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";

describe("routing config routes", () => {
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

  function createAuthedApp(send?: ReturnType<typeof vi.fn>): Hono {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });

    app.route(
      "/",
      createRoutingConfigRoutes({
        db,
        routingConfigDal: new RoutingConfigDal(db),
        channelThreadDal: new ChannelThreadDal(db),
        ...(send
          ? {
              ws: {
                connectionManager: {
                  allClients: () => [
                    {
                      role: "client",
                      auth_claims: {
                        token_kind: "admin",
                        token_id: "test-token",
                        tenant_id: DEFAULT_TENANT_ID,
                        role: "admin",
                        scopes: ["*"],
                      },
                      ws: { send },
                    },
                  ],
                },
              },
            }
          : {}),
      } as never),
    );

    return app;
  }

  function createAppWithoutTenantId(): Hono {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });

    app.route(
      "/",
      createRoutingConfigRoutes({
        db,
        routingConfigDal: new RoutingConfigDal(db),
        channelThreadDal: new ChannelThreadDal(db),
      } as never),
    );

    return app;
  }

  it("persists routing config revisions and emits ws events", async () => {
    const send = vi.fn();
    const app = createAuthedApp(send);

    const res = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          v: 1,
          telegram: {
            default_agent_key: "default",
            threads: {
              "123": "agent-b",
            },
          },
        },
        reason: "seed",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { revision: number; config: unknown };
    expect(body.revision).toBeGreaterThan(0);
    expect(body.config).toMatchObject({
      telegram: { threads: { "123": "agent-b" } },
    });

    const fetchRes = await app.request("/routing/config", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as { revision: number; config: unknown };
    expect(fetched.revision).toBe(body.revision);

    expect(send).toHaveBeenCalled();
    const payload = send.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    const evt = JSON.parse(String(payload)) as { type?: string; payload?: unknown };
    expect(evt.type).toBe("routing.config.updated");
    expect(evt.payload).toMatchObject({ revision: body.revision, reason: "seed" });
    expect(evt.payload as Record<string, unknown>).not.toHaveProperty("config");
  });

  it("reverts to an earlier revision", async () => {
    const send = vi.fn();
    const app = createAuthedApp(send);

    const created = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          v: 1,
          telegram: {
            default_agent_key: "default",
            threads: {
              "123": "agent-b",
            },
          },
        },
        reason: "seed",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { revision: number; config: unknown };

    const updated = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { v: 1 },
        reason: "blank",
      }),
    });
    expect(updated.status).toBe(201);

    const reverted = await app.request("/routing/config/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: createdBody.revision, reason: "rollback" }),
    });

    expect(reverted.status).toBe(201);
    const revertedBody = (await reverted.json()) as { revision: number; config: unknown };
    expect(revertedBody.revision).toBeGreaterThan(createdBody.revision);
    expect(revertedBody.config).toEqual(createdBody.config);

    const latest = await app.request("/routing/config", { method: "GET" });
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toMatchObject({
      revision: revertedBody.revision,
      reverted_from_revision: createdBody.revision,
    });

    const audit = await db.all<{ action_json: string }>(
      `SELECT pe.action_json
       FROM planner_events pe
       JOIN plans p
         ON p.tenant_id = pe.tenant_id
        AND p.plan_id = pe.plan_id
       WHERE pe.tenant_id = ?
         AND p.plan_key = ?
       ORDER BY pe.step_index ASC`,
      [DEFAULT_TENANT_ID, "routing.config"],
    );
    expect(audit).toHaveLength(3);
    const action = JSON.parse(audit[2]!.action_json) as Record<string, unknown>;
    expect(action).toMatchObject({
      type: "routing.config.updated",
      revision: revertedBody.revision,
      reverted_from_revision: createdBody.revision,
    });
  });

  it("returns a structured error when the durable routing config state is corrupt", async () => {
    await db.run(
      "INSERT INTO routing_configs (tenant_id, config_json, created_by_json, reason) VALUES (?, ?, ?, ?)",
      [DEFAULT_TENANT_ID, JSON.stringify({ v: "invalid" }), "{}", "corrupt"],
    );

    const app = createAuthedApp();

    const res = await app.request("/routing/config", { method: "GET" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "corrupt_state" });
  });

  it("lists routing config revisions newest first", async () => {
    const app = createAuthedApp();

    await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { v: 1, telegram: { default_agent_key: "default" } },
        reason: "first",
      }),
    });
    await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { v: 1, telegram: { default_agent_key: "agent-b" } },
        reason: "second",
      }),
    });

    const res = await app.request("/routing/config/revisions?limit=1", { method: "GET" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      revisions: [
        {
          revision: 2,
          reason: "second",
          config: { telegram: { default_agent_key: "agent-b" } },
        },
      ],
    });
  });

  it("lists observed telegram threads with best-effort session metadata", async () => {
    const app = createAuthedApp();
    const identity = new IdentityScopeDal(db);
    const workspaceId = await identity.ensureWorkspaceId(DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_KEY);
    const agentId = await identity.ensureAgentId(DEFAULT_TENANT_ID, DEFAULT_AGENT_KEY);
    await identity.ensureMembership(DEFAULT_TENANT_ID, agentId, workspaceId);

    const channelThreads = new ChannelThreadDal(db);
    const channelAccountId = await channelThreads.ensureChannelAccountId({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId,
      connectorKey: "telegram",
      accountKey: "default",
    });
    const channelThreadId = await channelThreads.ensureChannelThreadId({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId,
      channelAccountId,
      providerThreadId: "thread-42",
      containerKind: "group",
    });

    await db.run(
      `INSERT INTO sessions (
         tenant_id, session_id, session_key, agent_id, workspace_id, channel_thread_id,
         title, summary, transcript_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "session-1",
        "agent:default:telegram:group:thread-42",
        agentId,
        workspaceId,
        channelThreadId,
        "Support room",
        "",
        "[]",
        "2026-03-01T00:00:00.000Z",
        "2026-03-02T00:00:00.000Z",
      ],
    );

    const res = await app.request("/routing/channels/telegram/threads", { method: "GET" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      threads: [
        {
          channel: "telegram",
          account_key: "default",
          thread_id: "thread-42",
          container_kind: "group",
          session_title: "Support room",
          last_active_at: "2026-03-02T00:00:00.000Z",
        },
      ],
    });
  });

  it("reads telegram connection config without returning secret values", async () => {
    const app = createAuthedApp();

    const update = await app.request("/routing/channels/telegram/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot_token: "telegram-bot-token",
        webhook_secret: "telegram-webhook-secret",
        allowed_user_ids: ["123", "456"],
        pipeline_enabled: false,
        reason: "configure telegram",
      }),
    });

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      config: {
        bot_token_configured: true,
        webhook_secret_configured: true,
        allowed_user_ids: ["123", "456"],
        pipeline_enabled: false,
      },
    });

    const fetchRes = await app.request("/routing/channels/telegram/config", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as {
      config: Record<string, unknown>;
    };
    expect(fetched.config).toMatchObject({
      bot_token_configured: true,
      webhook_secret_configured: true,
      allowed_user_ids: ["123", "456"],
      pipeline_enabled: false,
    });
    expect(fetched.config).not.toHaveProperty("bot_token");
    expect(fetched.config).not.toHaveProperty("webhook_secret");
  });

  it("allows clearing stored telegram secrets while preserving other config", async () => {
    const app = createAuthedApp();

    const seed = await app.request("/routing/channels/telegram/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot_token: "telegram-bot-token",
        webhook_secret: "telegram-webhook-secret",
        allowed_user_ids: ["123"],
      }),
    });
    expect(seed.status).toBe(200);

    const clear = await app.request("/routing/channels/telegram/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clear_bot_token: true,
        clear_webhook_secret: true,
        allowed_user_ids: ["123"],
      }),
    });
    expect(clear.status).toBe(200);
    await expect(clear.json()).resolves.toMatchObject({
      config: {
        bot_token_configured: false,
        webhook_secret_configured: false,
        allowed_user_ids: ["123"],
        pipeline_enabled: true,
      },
    });
  });

  it("requires tenant-scoped claims for telegram connection config endpoints", async () => {
    const app = createAppWithoutTenantId();

    const getRes = await app.request("/routing/channels/telegram/config", { method: "GET" });
    expect(getRes.status).toBe(403);

    const putRes = await app.request("/routing/channels/telegram/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_user_ids: ["123"] }),
    });
    expect(putRes.status).toBe(403);
  });
});
