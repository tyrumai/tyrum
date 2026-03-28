import { expect, it, vi } from "vitest";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import {
  TelegramChannelProcessor,
  TelegramChannelQueue,
} from "../../src/modules/channels/telegram.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
import {
  createIngressApp,
  makeAgents,
  makeRejectedRuntime,
  makeResolvedRuntime,
  makeConversationDal,
  makeTelegramUpdate,
  mockFetch,
  openTelegramQueueTestDb,
  postTelegramUpdate,
  setupTelegramProcessorHarness,
  type TelegramQueueTestState,
} from "./telegram-queue.test-fixtures.js";

export function registerTelegramQueueAccountTests(state: TelegramQueueTestState): void {
  it("does not allow webhook callers to override the Telegram account id", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const telegramBot = new TelegramBot("test-token", mockFetch());
    const queue = new TelegramChannelQueue(db, { conversationDal });
    const app = createIngressApp({ bot: telegramBot, queue, runtime: {} });

    const res = await postTelegramUpdate(app, makeTelegramUpdate("Help me"), "?account_id=work");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inbox_id: number };
    expect(body.ok).toBe(true);

    const inbox = new ChannelInboxDal(db, conversationDal);
    const row = await inbox.getById(body.inbox_id);
    expect(row?.source).toBe("telegram:default");
  });

  it("uses DM key shape for private Telegram chats", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-c1",
      channelKey: "work",
    });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:dm:123");
  });

  it("links per-peer dm conversation keys via canonical identity mapping", async () => {
    const db = openTelegramQueueTestDb(state);
    await db.run(
      `INSERT INTO peer_identity_links (tenant_id, channel, account, provider_peer_id, canonical_peer_id)
       VALUES (?, ?, ?, ?, ?)`,
      ["00000000-0000-4000-8000-000000000001", "telegram", "work", "123", "canon-1"],
    );

    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-c1",
      channelKey: "work",
      dmScope: "per_peer",
    });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:dm:canon-1");
  });

  it("falls back to provider peer id when canonical peer id is invalid", async () => {
    const db = openTelegramQueueTestDb(state);
    await db.run(
      `INSERT INTO peer_identity_links (tenant_id, channel, account, provider_peer_id, canonical_peer_id)
       VALUES (?, ?, ?, ?, ?)`,
      ["00000000-0000-4000-8000-000000000001", "telegram", "work", "123", "bad:peer"],
    );

    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-c1",
      channelKey: "work",
      dmScope: "per_peer",
    });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:dm:123");
  });

  it("defaults telegram account id to default", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, { conversationDal, agentId: "agent-c1" });
    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:default:dm:123");

    const inbox = new ChannelInboxDal(db, conversationDal);
    const row = await inbox.getById(enqueued.inbox.inbox_id);
    expect(
      (row?.payload as { message?: { envelope?: { delivery?: { account?: string } } } })?.message
        ?.envelope?.delivery?.account,
    ).toBe("default");
  });

  it("uses canonical group conversation key taxonomy", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-c1",
      channelKey: "work",
    });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Group hello", 555, { chatType: "group", senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:group:555");
  });

  it("uses canonical channel conversation key taxonomy", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-c1",
      channelKey: "work",
    });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("announce", 456, { chatType: "channel", senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:channel:456");
  });

  it("isolates dedupe keys per connector account", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, { conversationDal });
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));

    const workAccount = await queue.enqueue(normalized, { accountId: "work" });
    const personalAccount = await queue.enqueue(normalized, { accountId: "personal" });

    expect(workAccount.deduped).toBe(false);
    expect(personalAccount.deduped).toBe(false);
    expect(personalAccount.inbox.inbox_id).not.toBe(workAccount.inbox.inbox_id);
  });

  it("stamps the normalized envelope delivery identity with the queue account id", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const queue = new TelegramChannelQueue(db, { conversationDal });
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    const enqueued = await queue.enqueue(normalized, { accountId: "work" });

    const inbox = new ChannelInboxDal(db, conversationDal);
    const row = await inbox.getById(enqueued.inbox.inbox_id);
    expect(
      (row?.payload as { message?: { envelope?: { delivery?: { account?: string } } } })?.message
        ?.envelope?.delivery?.account,
    ).toBe("work");
  });

  it("dedupes default-account messages against existing inbox rows", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    const inbox = new ChannelInboxDal(db, conversationDal);
    const existing = await inbox.enqueue({
      source: "telegram:default",
      thread_id: normalized.thread.id,
      message_id: normalized.message.id,
      key: "legacy-key",
      received_at_ms: Date.now(),
      payload: normalized,
    });
    const queue = new TelegramChannelQueue(db, { conversationDal });
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.deduped).toBe(true);
    expect(enqueued.inbox.inbox_id).toBe(existing.row.inbox_id);
  });

  it("derives account-appropriate thread keys when enqueue overrides account id", async () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Help me", 123, { chatType: "group" })),
    );

    const defaultQueue = new TelegramChannelQueue(db, { conversationDal, accountId: "default" });
    const workQueue = new TelegramChannelQueue(db, { conversationDal, accountId: "work" });

    const viaOverride = await defaultQueue.enqueue(normalized, { accountId: "work" });
    const viaWorkQueue = await workQueue.enqueue(normalized);

    expect(viaOverride.inbox.key).toBe("agent:default:telegram:work:group:123");
    expect(viaOverride.inbox.key).toBe(viaWorkQueue.inbox.key);
  });

  it("normalizes connector ids when binding no-account egress connectors", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const { fetchFn, processor, queue } = setupTelegramProcessorHarness(state, {
      processorOptions: {
        egressConnectors: [{ connector: " telegram ", sendMessage: send }],
      },
      runtime: makeResolvedRuntime("hello"),
    });

    await queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))));
    await processor.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects connector ids that contain ':' when binding no-account egress connectors", () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const telegramBot = new TelegramBot("test-token", mockFetch());

    expect(
      () =>
        new TelegramChannelProcessor({
          db,
          conversationDal,
          agents: makeAgents(makeResolvedRuntime("hello")),
          telegramBot,
          owner: "test-owner",
          debounceMs: 0,
          maxBatch: 1,
          egressConnectors: [{ connector: "telegram:work", sendMessage: vi.fn() }],
        }),
    ).toThrow("connector must not contain ':'");
  });

  it("rejects whitespace-only account ids when binding egress connectors", () => {
    const db = openTelegramQueueTestDb(state);
    const conversationDal = makeConversationDal(db);
    const telegramBot = new TelegramBot("test-token", mockFetch());

    expect(
      () =>
        new TelegramChannelProcessor({
          db,
          conversationDal,
          agents: makeAgents(makeResolvedRuntime("hello")),
          telegramBot,
          owner: "test-owner",
          debounceMs: 0,
          maxBatch: 1,
          egressConnectors: [{ connector: "telegram", accountId: "   ", sendMessage: vi.fn() }],
        }),
    ).toThrow(/account must be non-empty/);
  });

  it("uses account-specific egress connectors when provided", async () => {
    const defaultSend = vi.fn().mockResolvedValue({ ok: true, account: "default" });
    const workSend = vi.fn().mockResolvedValue({ ok: true, account: "work" });
    const { fetchFn, processor, queue } = setupTelegramProcessorHarness(state, {
      processorOptions: {
        egressConnectors: [
          { connector: "telegram", accountId: "default", sendMessage: defaultSend },
          { connector: "telegram", accountId: "work", sendMessage: workSend },
        ],
      },
    });

    await queue.enqueue(
      normalizeUpdate(JSON.stringify(makeTelegramUpdate("default", 123, { messageId: 1001 }))),
      { accountId: "default" },
    );
    await queue.enqueue(
      normalizeUpdate(JSON.stringify(makeTelegramUpdate("work", 123, { messageId: 1002 }))),
      { accountId: "work" },
    );

    await processor.tick();
    await processor.tick();

    expect(defaultSend).toHaveBeenCalledTimes(1);
    expect(workSend).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends agent failure messages via account-specific egress connectors", async () => {
    const workSend = vi.fn().mockResolvedValue({ ok: true, account: "work" });
    const { fetchFn, processor, queue } = setupTelegramProcessorHarness(state, {
      processorOptions: {
        egressConnectors: [{ connector: "telegram", accountId: "work", sendMessage: workSend }],
      },
      runtime: makeRejectedRuntime(),
    });

    await queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("work", 123, 3001))), {
      accountId: "work",
    });
    await processor.tick();

    expect(workSend).toHaveBeenCalledTimes(1);
    expect(workSend).toHaveBeenCalledWith({
      accountId: "work",
      containerId: "123",
      content: {
        text: "Sorry, something went wrong. Please try again later.",
        attachments: [],
      },
      parseMode: "HTML",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
}
