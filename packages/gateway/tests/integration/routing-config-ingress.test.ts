import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { TelegramChannelRuntime } from "../../src/modules/channels/telegram-runtime.js";

describe("routing config (durable) + ingress", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
  });

  afterEach(async () => {
    if (didOpenDb) {
      didOpenDb = false;
      await db.close();
    }
  });

  function createTelegramRuntime(): TelegramChannelRuntime {
    return new TelegramChannelRuntime(new ChannelConfigDal(db));
  }

  function createIdentityScopeDal(): IdentityScopeDal {
    return new IdentityScopeDal(db);
  }

  async function seedTelegramAccount(input: {
    accountKey: string;
    agentKey?: string;
    botToken?: string;
    webhookSecret?: string;
    allowedUserIds?: string[];
    pipelineEnabled?: boolean;
  }): Promise<void> {
    await new ChannelConfigDal(db).createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: input.accountKey,
      agentKey: input.agentKey,
      ingressMode: "webhook",
      botToken: input.botToken,
      webhookSecret: input.webhookSecret,
      allowedUserIds: input.allowedUserIds,
      pipelineEnabled: input.pipelineEnabled,
    });
  }

  it("routes telegram updates using durable routing config state scoped to the matched account", async () => {
    const routing = new RoutingConfigDal(db);
    await routing.set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: {
          accounts: {
            work: {
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
      occurredAtIso: "2026-02-24T00:00:00.000Z",
    });
    await seedTelegramAccount({
      accountKey: "work",
      botToken: "bot-token-work",
      webhookSecret: "secret-work",
      pipelineEnabled: true,
    });

    let capturedAgentId: string | undefined;
    let capturedAccountId: string | undefined;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: createTelegramRuntime(),
        agents: {} as never,
        telegramQueue: {
          enqueue: async (_normalized, opts) => {
            capturedAgentId = opts?.agentId;
            capturedAccountId = opts?.accountId;
            return {
              inbox: { inbox_id: 1, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        routingConfigDal: routing,
        identityScopeDal: createIdentityScopeDal(),
      }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(capturedAgentId).toBe("agent-b");
    expect(capturedAccountId).toBe("work");

    const stored = await new ChannelConfigDal(db).getTelegramByAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "work",
    });
    expect(stored?.agent_key).toBeUndefined();
  });

  it("falls back to the default agent when durable routing config state is invalid", async () => {
    await db.run(
      "INSERT INTO routing_configs (tenant_id, config_json, created_by_json, reason) VALUES (?, ?, ?, ?)",
      [DEFAULT_TENANT_ID, JSON.stringify({ v: "invalid" }), "{}", "corrupt"],
    );
    await seedTelegramAccount({
      accountKey: "work",
      botToken: "bot-token-work",
      webhookSecret: "secret-work",
      pipelineEnabled: true,
    });

    let capturedAgentId: string | undefined;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: createTelegramRuntime(),
        agents: {} as never,
        telegramQueue: {
          enqueue: async (_normalized, opts) => {
            capturedAgentId = opts?.agentId;
            return {
              inbox: { inbox_id: 1, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        routingConfigDal: new RoutingConfigDal(db),
        identityScopeDal: createIdentityScopeDal(),
      }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(capturedAgentId).toBe("default");
  });

  it("ignores telegram agent_key query overrides once an account binding exists", async () => {
    await seedTelegramAccount({
      accountKey: "work",
      agentKey: "agent-b",
      botToken: "bot-token-work",
      webhookSecret: "secret-work",
      pipelineEnabled: true,
    });

    let capturedAgentId: string | undefined;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: createTelegramRuntime(),
        agents: {} as never,
        telegramQueue: {
          enqueue: async (_normalized, opts) => {
            capturedAgentId = opts?.agentId;
            return {
              inbox: { inbox_id: 1, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        identityScopeDal: createIdentityScopeDal(),
      }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram?agent_key=default", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    expect(capturedAgentId).toBe("agent-b");
  });

  it("ignores telegram updates from senders outside the configured allowlist", async () => {
    await seedTelegramAccount({
      accountKey: "work",
      botToken: "bot-token-work",
      webhookSecret: "secret-work",
      allowedUserIds: ["111"],
      pipelineEnabled: true,
    });

    let enqueueCalled = false;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: createTelegramRuntime(),
        agents: {} as never,
        telegramQueue: {
          enqueue: async () => {
            enqueueCalled = true;
            return {
              inbox: { inbox_id: 1, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        identityScopeDal: createIdentityScopeDal(),
      }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      ignored: true,
      reason: "sender_not_allowlisted",
    });
    expect(enqueueCalled).toBe(false);
  });

  it("routes identical thread ids independently for different telegram accounts", async () => {
    const routing = new RoutingConfigDal(db);
    await routing.set({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        v: 1,
        telegram: {
          accounts: {
            work: {
              default_agent_key: "default",
              threads: {
                "123": "agent-b",
              },
            },
            personal: {
              default_agent_key: "default",
              threads: {
                "123": "agent-c",
              },
            },
          },
        },
      },
      createdBy: { kind: "test" },
      reason: "seed",
      occurredAtIso: "2026-02-24T00:00:00.000Z",
    });
    await seedTelegramAccount({
      accountKey: "work",
      botToken: "bot-token-work",
      webhookSecret: "secret-work",
      pipelineEnabled: true,
    });
    await seedTelegramAccount({
      accountKey: "personal",
      botToken: "bot-token-personal",
      webhookSecret: "secret-personal",
      pipelineEnabled: true,
    });

    const captured: Array<{ agentId?: string; accountId?: string }> = [];
    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramRuntime: createTelegramRuntime(),
        agents: {} as never,
        telegramQueue: {
          enqueue: async (_normalized, opts) => {
            captured.push({ agentId: opts?.agentId, accountId: opts?.accountId });
            return {
              inbox: { inbox_id: captured.length, status: "queued" },
              deduped: false,
              message_text: "Hello bot",
            };
          },
        } as never,
        routingConfigDal: routing,
        identityScopeDal: createIdentityScopeDal(),
      }),
    );

    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const first = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-work",
      },
      body: JSON.stringify(update),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "secret-personal",
      },
      body: JSON.stringify(update),
    });
    expect(second.status).toBe(200);

    expect(captured).toEqual([
      { agentId: "agent-b", accountId: "work" },
      { agentId: "agent-c", accountId: "personal" },
    ]);
  });
});
