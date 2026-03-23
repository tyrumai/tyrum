import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { TelegramPollingMonitor } from "../../src/modules/channels/telegram-polling-monitor.js";
import { TelegramPollingStateDal } from "../../src/modules/channels/telegram-polling-state-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function makeTelegramUpdate(updateId = 100) {
  return {
    update_id: updateId,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      from: { id: 999, is_bot: false, first_name: "Alice" },
      chat: { id: 123, type: "private" },
      text: "Hello from polling",
    },
  };
}

function waitForAbort(signal?: AbortSignal): Promise<[]> {
  return new Promise<[]>((resolve) => {
    signal?.addEventListener("abort", () => resolve([]), { once: true });
  });
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("TelegramPollingMonitor", () => {
  let db: SqliteDb;
  let dal: ChannelConfigDal;
  let stateDal: TelegramPollingStateDal;
  let identityScopeDal: IdentityScopeDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new ChannelConfigDal(db);
    stateDal = new TelegramPollingStateDal(db);
    identityScopeDal = new IdentityScopeDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("processes polling updates, advances the cursor, and clears the webhook once per lease", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: 1 },
      deduped: false,
      message_text: "Hello from polling",
    }));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
        opts?.offset === 101 ? await waitForAbort(opts.signal) : [makeTelegramUpdate(100)],
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      logger: logger as never,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.next_update_id === 101;
    });
    await monitor.stop();

    expect(enqueue).toHaveBeenCalledOnce();
    expect(bot.deleteWebhook).toHaveBeenCalledOnce();
    expect(bot.deleteWebhook).toHaveBeenCalledWith({ drop_pending_updates: false });
    expect(bot.getUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.polling.webhook_deleted",
      expect.objectContaining({ account_key: "alerts", owner: "worker-a" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.polling.offset_advanced",
      expect.objectContaining({
        account_key: "alerts",
        update_id: 100,
        next_update_id: 101,
        reason: "processed",
      }),
    );
  });

  it("retries temporary failures without advancing the cursor", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { signal?: AbortSignal }) =>
        opts?.signal ? [makeTelegramUpdate(100)] : [makeTelegramUpdate(100)],
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: {
        enqueue: vi.fn(async () => {
          throw new Error("queue unavailable");
        }),
      } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      logger: logger as never,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.status === "error";
    });
    await monitor.stop();

    const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
    expect(row).toMatchObject({
      status: "idle",
      next_update_id: null,
      last_error_message: "failed to queue telegram update; please retry",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "channel.telegram.polling.retrying_update",
      expect.objectContaining({ account_key: "alerts", update_id: 100 }),
    );
  });

  it("stops an in-flight long poll when the account switches back to webhook mode", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    let aborted = false;
    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(
        (opts?: { signal?: AbortSignal }) =>
          new Promise<[]>((resolve) => {
            opts?.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve([]);
            });
          }),
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue: vi.fn() } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(() => bot.getUpdates.mock.calls.length > 0);

    await dal.updateTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "webhook",
    });

    await waitUntil(() => aborted);
    await monitor.stop();

    const stored = await dal.getTelegramByAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
    });
    expect(stored).toMatchObject({
      ingress_mode: "webhook",
      webhook_secret: "saved-webhook-secret",
    });
  });

  it("uses the lease row so two monitors do not enqueue the same update twice", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    let served = false;
    const makeBot = () => ({
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) => {
        if (typeof opts?.offset === "number" || served) {
          return await waitForAbort(opts?.signal);
        }
        served = true;
        return [makeTelegramUpdate(100)];
      }),
    });

    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: 1 },
      deduped: false,
      message_text: "Hello from polling",
    }));
    const monitorA = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => makeBot()) } as never,
      queue: { enqueue } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });
    const monitorB = new TelegramPollingMonitor({
      owner: "worker-b",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => makeBot()) } as never,
      queue: { enqueue } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitorA.start();
    monitorB.start();
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.next_update_id === 101;
    });

    await Promise.all([monitorA.stop(), monitorB.stop()]);

    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("resets the polling offset before long polling when the bot identity changes", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });
    await stateDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "seed-owner",
      nowMs: 1_000,
      leaseTtlMs: 30_000,
    });
    await stateDal.updateCursor({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "seed-owner",
      botUserId: "111",
      nextUpdateId: 777,
      polledAt: "2026-03-19T08:00:00.000Z",
    });
    await stateDal.release({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      owner: "seed-owner",
    });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const bot = {
      getMe: vi.fn(async () => ({ id: 222, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(
        async (opts?: { signal?: AbortSignal }) => await waitForAbort(opts?.signal),
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue: vi.fn() } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      logger: logger as never,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(() => bot.getUpdates.mock.calls.length > 0);
    await monitor.stop();

    expect(bot.getUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: undefined,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.polling.bot_identity_changed",
      expect.objectContaining({
        account_key: "alerts",
        previous_bot_user_id: "111",
        next_bot_user_id: "222",
      }),
    );
  });

  it("advances the offset when an update is skipped during normalization", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
        opts?.offset === 101 ? await waitForAbort(opts.signal) : [{ update_id: 100 }],
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue: vi.fn() } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      logger: logger as never,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.next_update_id === 101;
    });
    await monitor.stop();

    expect(logger.warn).toHaveBeenCalledWith(
      "channel.telegram.polling.update_skipped",
      expect.objectContaining({ account_key: "alerts", update_id: 100 }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.polling.offset_advanced",
      expect.objectContaining({
        account_key: "alerts",
        update_id: 100,
        next_update_id: 101,
        reason: "normalization_skipped",
      }),
    );
  });

  it("starts draining updates when an account switches from webhook to polling", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "webhook",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: 1 },
      deduped: false,
      message_text: "Hello from polling",
    }));
    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
        opts?.offset === 101 ? await waitForAbort(opts.signal) : [makeTelegramUpdate(100)],
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await dal.updateTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
    });
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.next_update_id === 101;
    });
    await monitor.stop();

    const stored = await dal.getTelegramByAccountKey({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
    });
    expect(stored).toMatchObject({
      ingress_mode: "polling",
      webhook_secret: "saved-webhook-secret",
    });
    expect(bot.deleteWebhook).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("reuses the bot identity across poll cycles until the bot instance changes", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    const bot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { signal?: AbortSignal }) => {
        if (bot.getUpdates.mock.calls.length >= 2) {
          return await waitForAbort(opts?.signal);
        }
        return [];
      }),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue: vi.fn() } as never,
      agents: {} as never,
      stateDal,
      identityScopeDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(() => bot.getUpdates.mock.calls.length >= 2);
    await monitor.stop();

    expect(bot.getMe).toHaveBeenCalledOnce();
  });
});
