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

describe("channel config routes", () => {
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

  it("lists configurable channel registry entries and applies legacy telegram agent fallback without persisting it", async () => {
    const dal = new ChannelConfigDal(db);
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      botToken: "telegram-bot-token",
      webhookSecret: "telegram-webhook-secret",
      allowedUserIds: ["123"],
    });
    await new RoutingConfigDal(db).set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: {
          accounts: {
            default: {
              default_agent_key: "agent-b",
            },
          },
        },
      },
      reason: "seed",
    });

    const app = createAuthedApp();

    const registryRes = await app.request("/config/channels/registry");
    expect(registryRes.status).toBe(200);
    await expect(registryRes.json()).resolves.toMatchObject({
      status: "ok",
      channels: [
        { channel: "telegram", configurable: true },
        { channel: "discord", configurable: true },
        { channel: "googlechat", configurable: true },
      ],
    });

    const listRes = await app.request("/config/channels");
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      status: "ok",
      channels: [
        {
          channel: "telegram",
          accounts: [
            {
              account_key: "default",
              config: {
                agent_key: "agent-b",
                allowed_user_ids: ["123"],
                pipeline_enabled: true,
              },
              configured_secret_keys: ["bot_token", "webhook_secret"],
            },
          ],
        },
      ],
    });

    const stored = await dal.getTelegramByAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
    });
    expect(stored?.agent_key).toBeUndefined();
  });

  it("creates Discord accounts and resolves usernames and guild/channel labels to canonical IDs", async () => {
    const discordFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://discord.com/api/v10/users/@me/guilds") {
        return new Response(JSON.stringify([{ id: "1234567890", name: "My Server" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://discord.com/api/v10/guilds/1234567890/members/search?")) {
        return new Response(
          JSON.stringify([{ user: { id: "3333", username: "alice", bot: false } }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url === "https://discord.com/api/v10/guilds/1234567890/channels") {
        return new Response(
          JSON.stringify([{ id: "2222", guild_id: "1234567890", name: "general" }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`Unexpected Discord API request: ${url}`);
    });
    vi.stubGlobal("fetch", discordFetch as typeof fetch);

    const app = createAuthedApp();
    const res = await app.request("/config/channels/accounts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        channel: "discord",
        account_key: "community",
        config: {
          agent_key: "agent-b",
          allowed_user_ids: "@alice",
          allowed_channels: "My Server/#general",
        },
        secrets: {
          bot_token: "discord-bot-token",
        },
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "discord",
        account_key: "community",
        config: {
          agent_key: "agent-b",
          allowed_user_ids: ["3333"],
          allowed_channels: ["guild:1234567890/channel:2222"],
        },
        configured_secret_keys: ["bot_token"],
      },
    });

    const stored = await new ChannelConfigDal(db).getByChannelAndAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      connectorKey: "discord",
      accountKey: "community",
    });
    expect(stored).toMatchObject({
      channel: "discord",
      agent_key: "agent-b",
      allowed_user_ids: ["3333"],
      allowed_channels: ["guild:1234567890/channel:2222"],
    });
    expect(discordFetch).toHaveBeenCalledTimes(4);
  });

  it("supports Google Chat auth methods and normalizes stored access lists", async () => {
    const app = createAuthedApp();

    const created = await app.request("/config/channels/accounts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        channel: "googlechat",
        account_key: "chat",
        config: {
          agent_key: "default",
          auth_method: "file_path",
          service_account_file: "/tmp/service-account.json",
          audience_type: "app-url",
          audience: "https://example.test/googlechat",
          allowed_users: "users/123, User@Example.com",
        },
        secrets: {},
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "googlechat",
        account_key: "chat",
        config: {
          agent_key: "default",
          auth_method: "file_path",
          service_account_file: "/tmp/service-account.json",
          audience_type: "app-url",
          audience: "https://example.test/googlechat",
          allowed_users: ["users/123", "user@example.com"],
        },
        configured_secret_keys: [],
      },
    });

    const updated = await app.request("/config/channels/accounts/googlechat/chat", {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        config: {
          agent_key: "agent-b",
          auth_method: "inline_json",
          audience_type: "project-number",
          audience: "123456789",
          allowed_users: "User@Example.com",
        },
        secrets: {
          service_account_json: '{"type":"service_account"}',
        },
      }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      status: "ok",
      account: {
        channel: "googlechat",
        account_key: "chat",
        config: {
          agent_key: "agent-b",
          auth_method: "inline_json",
          audience_type: "project-number",
          audience: "123456789",
          allowed_users: ["user@example.com"],
        },
        configured_secret_keys: ["service_account_json"],
      },
    });

    const deleted = await app.request("/config/channels/accounts/googlechat/chat", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      status: "ok",
      deleted: true,
      channel: "googlechat",
      account_key: "chat",
    });
  });

  it("returns field-level validation errors for unresolved account setup values", async () => {
    const app = createAuthedApp();
    const res = await app.request("/config/channels/accounts", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        channel: "discord",
        account_key: "community",
        config: {
          agent_key: "agent-b",
          allowed_user_ids: "@alice",
        },
        secrets: {},
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_request",
      field_errors: {
        bot_token: ["Bot token is required"],
      },
    });
  });
});
