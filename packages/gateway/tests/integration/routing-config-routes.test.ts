import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRoutingConfigRoutes } from "../../src/routes/routing-config.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
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

  function createAuthedApp(): Hono {
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

  it("serves legacy routing config as a read-only compatibility surface", async () => {
    await new RoutingConfigDal(db).set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: {
          accounts: {
            default: {
              default_agent_key: "default",
              threads: {
                "123": "agent-b",
              },
            },
          },
        },
      },
      createdBy: { kind: "test" },
      reason: "seed",
      occurredAtIso: "2026-03-01T00:00:00.000Z",
    });

    const app = createAuthedApp();
    const fetchRes = await app.request("/routing/config", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    await expect(fetchRes.json()).resolves.toMatchObject({
      revision: 1,
      config: {
        telegram: {
          accounts: {
            default: {
              threads: { "123": "agent-b" },
            },
          },
        },
      },
      reason: "seed",
    });

    const putRes = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { v: 1 }, reason: "blocked" }),
    });
    expect(putRes.status).toBe(405);
    await expect(putRes.json()).resolves.toMatchObject({
      error: "unsupported_operation",
    });

    const revertRes = await app.request("/routing/config/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, reason: "blocked" }),
    });
    expect(revertRes.status).toBe(405);
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

    await new RoutingConfigDal(db).set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: { accounts: { default: { default_agent_key: "default" } } },
      },
      reason: "first",
      createdBy: { kind: "test" },
      occurredAtIso: "2026-03-01T00:00:00.000Z",
    });
    await new RoutingConfigDal(db).set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: { accounts: { default: { default_agent_key: "agent-b" } } },
      },
      reason: "second",
      createdBy: { kind: "test" },
      occurredAtIso: "2026-03-02T00:00:00.000Z",
    });

    const res = await app.request("/routing/config/revisions?limit=1", { method: "GET" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      revisions: [
        {
          revision: 2,
          reason: "second",
          config: {
            telegram: { accounts: { default: { default_agent_key: "agent-b" } } },
          },
        },
      ],
    });
  });

  it("lists observed telegram threads with best-effort conversation metadata", async () => {
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
      `INSERT INTO conversations (
         tenant_id, conversation_id, conversation_key, agent_id, workspace_id, channel_thread_id,
         title, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "conversation-1",
        "agent:default:telegram:group:thread-42",
        agentId,
        workspaceId,
        channelThreadId,
        "Support room",
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
          conversation_title: "Support room",
          last_active_at: "2026-03-02T00:00:00.000Z",
        },
      ],
    });
  });

  it("lists telegram channel configs without returning secret values and blocks legacy writes", async () => {
    await new ChannelConfigDal(db).createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
      botToken: "telegram-bot-token",
      webhookSecret: "telegram-webhook-secret",
      allowedUserIds: ["123", "456"],
      pipelineEnabled: false,
    });

    const app = createAuthedApp();

    const fetchRes = await app.request("/routing/channels/configs", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as {
      channels: Array<Record<string, unknown>>;
    };
    expect(fetched.channels).toEqual([
      expect.objectContaining({
        channel: "telegram",
        account_key: "work",
        bot_token_configured: true,
        webhook_secret_configured: true,
        allowed_user_ids: ["123", "456"],
        pipeline_enabled: false,
      }),
    ]);
    expect(fetched.channels[0]).not.toHaveProperty("bot_token");
    expect(fetched.channels[0]).not.toHaveProperty("webhook_secret");

    const create = await app.request("/routing/channels/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        account_key: "other",
      }),
    });
    expect(create.status).toBe(405);

    const update = await app.request("/routing/channels/configs/telegram/work", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clear_bot_token: true,
        clear_webhook_secret: true,
        allowed_user_ids: ["123"],
      }),
    });
    expect(update.status).toBe(405);

    const removed = await app.request("/routing/channels/configs/telegram/work", {
      method: "DELETE",
    });
    expect(removed.status).toBe(405);

    const listAfterDelete = await app.request("/routing/channels/configs", { method: "GET" });
    expect(listAfterDelete.status).toBe(200);
    await expect(listAfterDelete.json()).resolves.toMatchObject({
      channels: [
        {
          channel: "telegram",
          account_key: "work",
        },
      ],
    });
  });

  it("ignores legacy singleton telegram deployment config rows on list", async () => {
    await db.run(
      `INSERT INTO deployment_configs (config_json, created_by_json, reason)
       VALUES (?, ?, ?)`,
      [
        JSON.stringify({
          v: 1,
          channels: {
            telegramBotToken: "legacy-bot-token",
            telegramWebhookSecret: "legacy-webhook-secret",
            telegramAllowedUserIds: ["123", "456"],
            pipelineEnabled: false,
          },
        }),
        "{}",
        "legacy",
      ],
    );

    const app = createAuthedApp();
    const fetchRes = await app.request("/routing/channels/configs", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    await expect(fetchRes.json()).resolves.toMatchObject({ channels: [] });
  });

  it("requires tenant-scoped claims for channel config endpoints", async () => {
    const app = createAppWithoutTenantId();

    const getRes = await app.request("/routing/channels/configs", { method: "GET" });
    expect(getRes.status).toBe(403);

    const postRes = await app.request("/routing/channels/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        account_key: "work",
      }),
    });
    expect(postRes.status).toBe(403);
  });
});
