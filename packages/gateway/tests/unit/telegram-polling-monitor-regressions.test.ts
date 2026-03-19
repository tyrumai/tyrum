import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
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

describe("TelegramPollingMonitor regressions", () => {
  let db: SqliteDb;
  let dal: ChannelConfigDal;
  let stateDal: TelegramPollingStateDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new ChannelConfigDal(db);
    stateDal = new TelegramPollingStateDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("awaits lease cleanup before stop resolves", async () => {
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
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.lease_owner === "worker-a";
    });

    await monitor.stop();

    const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
    expect(row?.lease_owner).toBeNull();
  });

  it("applies allowlist changes before processing updates from an in-flight poll", async () => {
    await dal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      ingressMode: "polling",
      botToken: "bot-token",
      webhookSecret: "saved-webhook-secret",
    });

    let releaseFirstPoll: ((updates: ReturnType<typeof makeTelegramUpdate>[]) => void) | undefined;
    const firstPoll = new Promise<ReturnType<typeof makeTelegramUpdate>[]>((resolve) => {
      releaseFirstPoll = resolve;
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
        typeof opts?.offset === "number" ? await waitForAbort(opts.signal) : await firstPoll,
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "worker-a",
      channelConfigDal: dal,
      runtime: { getBotForTelegramAccount: vi.fn(() => bot) } as never,
      queue: { enqueue } as never,
      agents: {} as never,
      stateDal,
      logger: logger as never,
      reconcileIntervalMs: 10_000,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    monitor.start();
    await waitUntil(() => bot.getUpdates.mock.calls.length > 0);

    await dal.updateTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "alerts",
      allowedUserIds: ["123"],
    });
    releaseFirstPoll?.([makeTelegramUpdate(100)]);

    await waitUntil(async () => {
      const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "alerts" });
      return row?.next_update_id === 101;
    });
    await monitor.stop();

    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "ingress.telegram.sender_blocked",
      expect.objectContaining({
        account_key: "alerts",
        reason: "telegram_user_not_allowlisted",
        sender_id: "999",
      }),
    );
  });
});
