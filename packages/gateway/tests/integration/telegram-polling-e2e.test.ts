import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { TelegramPollingMonitor } from "../../src/modules/channels/telegram-polling-monitor.js";
import { TelegramPollingStateDal } from "../../src/modules/channels/telegram-polling-state-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createTelegramMediaFetch,
  createTestArtifactStore,
  makeAgents,
  makeResolvedRuntime,
  makeTelegramUpdate,
  mockFetch,
  setupTelegramProcessorHarness,
  TEST_TELEGRAM_WEBHOOK_SECRET,
  type TelegramQueueTestState,
} from "./telegram-queue.test-fixtures.js";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Telegram polling end-to-end", () => {
  it("enqueues the same inbound payload for webhook and polling mode", async () => {
    const enqueue = vi.fn(async () => ({
      inbox: { status: "queued", inbox_id: 1 },
      deduped: false,
      message_text: "Help me",
    }));

    const webhookBot = new TelegramBot("test-token", mockFetch());
    const webhookApp = new Hono();
    webhookApp.route(
      "/",
      createIngressRoutes({
        telegramRuntime: {
          listTelegramAccounts: vi.fn(async () => [
            {
              account_key: "default",
              agent_key: "triage",
              ingress_mode: "webhook" as const,
              bot_token: "test-token",
              webhook_secret: TEST_TELEGRAM_WEBHOOK_SECRET,
              allowed_user_ids: [],
              pipeline_enabled: true,
            },
          ]),
          getBotForTelegramAccount: vi.fn(() => webhookBot),
        } as never,
        agents: {} as never,
        telegramQueue: { enqueue } as never,
      }),
    );

    const webhookResponse = await webhookApp.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": TEST_TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(webhookResponse.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);

    const db = openTestSqliteDb();
    try {
      const channelConfigDal = new ChannelConfigDal(db);
      const stateDal = new TelegramPollingStateDal(db);
      await channelConfigDal.createTelegram({
        tenantId: DEFAULT_TENANT_ID,
        accountKey: "default",
        agentKey: "triage",
        ingressMode: "polling",
        botToken: "poll-token",
        webhookSecret: TEST_TELEGRAM_WEBHOOK_SECRET,
      });

      const pollingBot = {
        getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
        deleteWebhook: vi.fn(async () => true),
        getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
          opts?.offset === 101 ? await waitForAbort(opts.signal) : [makeTelegramUpdate("Help me")],
        ),
      };

      const monitor = new TelegramPollingMonitor({
        owner: "poller-a",
        channelConfigDal,
        runtime: {
          getBotForTelegramAccount: vi.fn(() => pollingBot),
        } as never,
        queue: { enqueue } as never,
        agents: {} as never,
        stateDal,
        reconcileIntervalMs: 20,
        idleDelayMs: 10,
        errorBackoffMs: 10,
      });

      monitor.start();
      await waitUntil(() => enqueue.mock.calls.length === 2);
      await monitor.stop();

      const [webhookEnvelope, webhookOptions] = enqueue.mock.calls[0] as [
        unknown,
        { agentId?: string; accountId?: string } | undefined,
      ];
      const [pollingEnvelope, pollingOptions] = enqueue.mock.calls[1] as [
        unknown,
        { agentId?: string; accountId?: string } | undefined,
      ];
      expect(pollingEnvelope).toEqual(webhookEnvelope);
      expect(pollingOptions).toEqual(webhookOptions);
    } finally {
      await db.close();
    }
  });

  it("polls updates, queues them, processes the queue, replies, and advances the cursor", async () => {
    const state: TelegramQueueTestState = { db: undefined };
    const runtime = makeResolvedRuntime("I can help with that!");
    const { db, fetchFn, processor, queue } = setupTelegramProcessorHarness(state, { runtime });
    const channelConfigDal = new ChannelConfigDal(db);
    const stateDal = new TelegramPollingStateDal(db);

    await channelConfigDal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      agentKey: "default",
      ingressMode: "polling",
      botToken: "poll-token",
      webhookSecret: TEST_TELEGRAM_WEBHOOK_SECRET,
    });

    const pollingBot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
        opts?.offset === 101 ? await waitForAbort(opts.signal) : [makeTelegramUpdate("Help me")],
      ),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "poller-a",
      channelConfigDal,
      runtime: {
        getBotForTelegramAccount: vi.fn(() => pollingBot),
      } as never,
      queue,
      agents: makeAgents(runtime),
      stateDal,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    try {
      monitor.start();
      await waitUntil(async () => {
        const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "default" });
        return row?.next_update_id === 101;
      });

      await processor.tick();

      expect(runtime.turn).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            delivery: { channel: "telegram", account: "default" },
            container: { kind: "dm", id: "123" },
            sender: expect.objectContaining({ id: "999" }),
            content: { text: "Help me", attachments: [] },
            provenance: ["user"],
          }),
        }),
      );
      expect(fetchFn).toHaveBeenCalledOnce();
      const [, sendOptions] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const sendBody = JSON.parse(sendOptions.body as string) as Record<string, unknown>;
      expect(sendBody["chat_id"]).toBe("123");
      expect(sendBody["text"]).toBe("I can help with that!");
      expect(sendBody["parse_mode"]).toBe("HTML");
    } finally {
      await monitor.stop();
      await db.close();
      state.db = undefined;
    }
  });

  it("materializes media attachments for polled updates before queueing them", async () => {
    const state: TelegramQueueTestState = { db: undefined };
    const runtime = makeResolvedRuntime("Got it.");
    const { db, processor, queue } = setupTelegramProcessorHarness(state, { runtime });
    const channelConfigDal = new ChannelConfigDal(db);
    const stateDal = new TelegramPollingStateDal(db);
    const artifactStore = createTestArtifactStore();

    await channelConfigDal.createTelegram({
      tenantId: DEFAULT_TENANT_ID,
      accountKey: "default",
      agentKey: "default",
      ingressMode: "polling",
      botToken: "poll-token",
      webhookSecret: TEST_TELEGRAM_WEBHOOK_SECRET,
    });

    const mediaFetch = createTelegramMediaFetch();
    const pollingBot = {
      getMe: vi.fn(async () => ({ id: 555, is_bot: true, first_name: "Tyrum" })),
      deleteWebhook: vi.fn(async () => true),
      getUpdates: vi.fn(async (opts?: { offset?: number; signal?: AbortSignal }) =>
        opts?.offset === 101
          ? await waitForAbort(opts.signal)
          : [
              {
                update_id: 100,
                message: {
                  message_id: 42,
                  date: 1700000000,
                  chat: { id: 123, type: "private" },
                  photo: [{ file_id: "file-1", width: 800, height: 600 }],
                },
              },
            ],
      ),
      downloadFileById: vi.fn(async (fileId: string) => {
        const bot = new TelegramBot("poll-token", mediaFetch);
        return await bot.downloadFileById(fileId);
      }),
    };

    const monitor = new TelegramPollingMonitor({
      owner: "poller-a",
      channelConfigDal,
      runtime: {
        getBotForTelegramAccount: vi.fn(() => pollingBot),
      } as never,
      queue,
      agents: makeAgents(runtime),
      stateDal,
      artifactStore,
      reconcileIntervalMs: 20,
      idleDelayMs: 10,
      errorBackoffMs: 10,
    });

    try {
      monitor.start();
      await waitUntil(async () => {
        const row = await stateDal.get({ tenantId: DEFAULT_TENANT_ID, accountKey: "default" });
        return row?.next_update_id === 101;
      });

      await processor.tick();

      expect(runtime.turn).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            content: expect.objectContaining({
              attachments: [expect.objectContaining({ media_class: "image" })],
            }),
          }),
        }),
      );
      expect(artifactStore.put).toHaveBeenCalledOnce();
      expect(mediaFetch).toHaveBeenCalledTimes(2);
    } finally {
      await monitor.stop();
      await db.close();
      state.db = undefined;
    }
  });
});
