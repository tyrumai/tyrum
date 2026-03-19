import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createChannelConfigRoutes } from "../../src/routes/channel-config.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import {
  DEFAULT_AGENT_KEY,
  DEFAULT_TENANT_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

const jsonHeaders = { "content-type": "application/json" };

describe("channel config route partial updates", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(async () => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;

    await db.run(
      `INSERT INTO tenants (tenant_id, tenant_key)
       VALUES (?, ?)
       ON CONFLICT (tenant_key) DO NOTHING`,
      [DEFAULT_TENANT_ID, "default"],
    );
    const identity = new IdentityScopeDal(db);
    await identity.ensureAgentId(DEFAULT_TENANT_ID, DEFAULT_AGENT_KEY);
    await identity.ensureAgentId(DEFAULT_TENANT_ID, "agent-b");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      createChannelConfigRoutes({
        db,
        routingConfigDal: new RoutingConfigDal(db),
      }),
    );
    return app;
  }

  it("preserves Telegram allowlists when partial updates omit them", async () => {
    await new ChannelConfigDal(db).createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      agentKey: "agent-b",
      ingressMode: "webhook",
      botToken: "telegram-bot-token",
      webhookSecret: "telegram-webhook-secret",
      allowedUserIds: ["123"],
      pipelineEnabled: true,
    });

    const app = createAuthedApp();
    const res = await app.request("/config/channels/accounts/telegram/default", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        config: {
          agent_key: "default",
          pipeline_enabled: false,
        },
        secrets: {},
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "telegram",
        account_key: "default",
        config: {
          agent_key: "default",
          ingress_mode: "webhook",
          allowed_user_ids: ["123"],
          pipeline_enabled: false,
        },
      },
    });

    const stored = await new ChannelConfigDal(db).getTelegramByAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
    });
    expect(stored).toMatchObject({
      channel: "telegram",
      agent_key: "default",
      ingress_mode: "webhook",
      allowed_user_ids: ["123"],
      pipeline_enabled: false,
    });
  });

  it("preserves Discord allowlists when partial updates omit them", async () => {
    await new ChannelConfigDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "discord",
        account_key: "community",
        agent_key: "agent-b",
        bot_token: "discord-bot-token",
        allowed_user_ids: ["3333"],
        allowed_channels: ["guild:1234567890/channel:2222"],
      },
    });
    const discordFetch = vi.fn();
    vi.stubGlobal("fetch", discordFetch as typeof fetch);

    const app = createAuthedApp();
    const res = await app.request("/config/channels/accounts/discord/community", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        config: {
          agent_key: "default",
        },
        secrets: {},
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "discord",
        account_key: "community",
        config: {
          agent_key: "default",
          allowed_user_ids: ["3333"],
          allowed_channels: ["guild:1234567890/channel:2222"],
        },
      },
    });

    const stored = await new ChannelConfigDal(db).getByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "discord",
      accountKey: "community",
    });
    expect(stored).toMatchObject({
      channel: "discord",
      agent_key: "default",
      allowed_user_ids: ["3333"],
      allowed_channels: ["guild:1234567890/channel:2222"],
    });
    expect(discordFetch).not.toHaveBeenCalled();
  });

  it("preserves Google Chat allowlists when partial updates omit them", async () => {
    await new ChannelConfigDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "googlechat",
        account_key: "chat",
        agent_key: "agent-b",
        auth_method: "inline_json",
        service_account_json: '{"type":"service_account"}',
        audience_type: "project-number",
        audience: "123456789",
        allowed_users: ["user@example.com"],
      },
    });

    const app = createAuthedApp();
    const res = await app.request("/config/channels/accounts/googlechat/chat", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        config: {
          agent_key: "default",
          auth_method: "inline_json",
          audience_type: "project-number",
          audience: "123456789",
        },
        secrets: {},
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "googlechat",
        account_key: "chat",
        config: {
          agent_key: "default",
          allowed_users: ["user@example.com"],
        },
        configured_secret_keys: ["service_account_json"],
      },
    });

    const stored = await new ChannelConfigDal(db).getByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "googlechat",
      accountKey: "chat",
    });
    expect(stored).toMatchObject({
      channel: "googlechat",
      agent_key: "default",
      allowed_users: ["user@example.com"],
    });
  });
});
