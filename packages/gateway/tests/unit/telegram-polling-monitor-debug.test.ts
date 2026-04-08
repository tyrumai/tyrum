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

describe("TelegramPollingMonitor debug diagnostics", () => {
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

  it("emits polling debug diagnostics when enabled for an account", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
      debugLoggingEnabled: true,
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

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.poll_request",
      expect.objectContaining({
        account_key: "alerts",
        owner: "worker-a",
        limit: 25,
        timeout_seconds: 30,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.poll_result",
      expect.objectContaining({
        account_key: "alerts",
        owner: "worker-a",
        update_count: 1,
        updates: [makeTelegramUpdate(100)],
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.poll_cursor_advanced",
      expect.objectContaining({
        account_key: "alerts",
        update_id: 100,
        next_update_id: 101,
        reason: "processed",
      }),
    );
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
