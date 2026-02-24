import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { TelegramChannelProcessor, TelegramChannelQueue } from "../../src/modules/channels/telegram.js";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTelegramUpdate(
  text: string,
  chatId = 123,
  opts?: {
    messageId?: number;
    chatType?: "private" | "group" | "supergroup" | "channel";
    senderId?: number;
  },
) {
  return {
    update_id: 100,
    message: {
      message_id: opts?.messageId ?? 42,
      date: 1700000000,
      from: { id: opts?.senderId ?? 999, is_bot: false, first_name: "Alice" },
      chat: { id: chatId, type: opts?.chatType ?? "private" },
      text,
    },
  };
}

function mockFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"ok":true}'),
    json: () => Promise.resolve({ ok: true }),
  }) as unknown as typeof fetch;
}

function makeAgents(runtime: unknown): AgentRegistry {
  return {
    getRuntime: async () => runtime,
    getPolicyService: () => ({ isEnabled: () => false }) as unknown as PolicyService,
  } as unknown as AgentRegistry;
}

describe("Telegram channel pipeline: enqueue -> process -> reply", () => {
  let db: SqliteDb | undefined;
  const originalWebhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  const originalPolicyBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
  const originalTelegramChannelKey = process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
  const originalTelegramAccountId = process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];

  beforeEach(() => {
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-telegram-secret";
    delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;

    if (originalWebhookSecret === undefined) {
      delete process.env["TELEGRAM_WEBHOOK_SECRET"];
    } else {
      process.env["TELEGRAM_WEBHOOK_SECRET"] = originalWebhookSecret;
    }

    if (originalPolicyBundlePath === undefined) {
      delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
    } else {
      process.env["TYRUM_POLICY_BUNDLE_PATH"] = originalPolicyBundlePath;
    }

    if (originalTelegramChannelKey === undefined) {
      delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    } else {
      process.env["TYRUM_TELEGRAM_CHANNEL_KEY"] = originalTelegramChannelKey;
    }

    if (originalTelegramAccountId === undefined) {
      delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
    } else {
      process.env["TYRUM_TELEGRAM_ACCOUNT_ID"] = originalTelegramAccountId;
    }
  });

  it("queues inbound updates durably and processes them via the channel processor", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const queue = new TelegramChannelQueue(db);
    const processor = new TelegramChannelProcessor({
      db,
      agents: makeAgents(mockRuntime),
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
    });

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime), telegramQueue: queue }),
    );

    const res1 = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean; queued?: boolean; deduped?: boolean };
    expect(body1.ok).toBe(true);
    expect(body1.queued).toBe(true);
    expect(body1.deduped).toBe(false);

    expect(mockRuntime.turn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();

    await processor.tick();

    expect(mockRuntime.turn).toHaveBeenCalledWith(
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
    const [, sendOpts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sendBody = JSON.parse(sendOpts.body as string) as Record<string, unknown>;
    expect(sendBody["parse_mode"]).toBe("HTML");

    const res2 = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; queued?: boolean; deduped?: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.deduped).toBe(true);

    await processor.tick();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("processes attachment-only messages by passing the normalized envelope through", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "Got it.",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const queue = new TelegramChannelQueue(db);
    const processor = new TelegramChannelProcessor({
      db,
      agents: makeAgents(mockRuntime),
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
    });

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({ telegramBot: bot, agents: makeAgents(mockRuntime), telegramQueue: queue }),
    );

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify({
        update_id: 100,
        message: {
          message_id: 43,
          date: 1700000000,
          from: { id: 999, is_bot: false, first_name: "Alice" },
          chat: { id: 123, type: "private" },
          caption: "  ",
          photo: [{ file_id: "abc" }],
        },
      }),
    });

    expect(res.status).toBe(200);

    await processor.tick();

    expect(mockRuntime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          container: { kind: "dm", id: "123" },
          content: expect.objectContaining({
            text: undefined,
            attachments: [{ kind: "photo" }],
          }),
          provenance: ["user"],
        }),
      }),
    );
  });

  it("does not allow webhook callers to override the Telegram account id", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        telegramBot: bot,
        agents: makeAgents({}),
        telegramQueue: queue,
      }),
    );

    const res = await app.request("/ingress/telegram?account_id=work", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(makeTelegramUpdate("Help me")),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inbox_id: number };
    expect(body.ok).toBe(true);

    const inbox = new ChannelInboxDal(db);
    const row = await inbox.getById(body.inbox_id);
    expect(row?.source).toBe("telegram");
  });

  it("uses DM key shape for private Telegram chats", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db, { agentId: "agent-c1", channelKey: "work" });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:dm:123");
  });

  it("links per-peer dm session keys via canonical identity mapping", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO peer_identity_links (channel, account, provider_peer_id, canonical_peer_id)
       VALUES (?, ?, ?, ?)`,
      ["telegram", "work", "123", "canon-1"],
    );

    const queue = new TelegramChannelQueue(db, {
      agentId: "agent-c1",
      channelKey: "work",
      dmScope: "per_peer",
    });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:dm:canon-1");
  });

  it("falls back to provider peer id when canonical peer id is invalid", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO peer_identity_links (channel, account, provider_peer_id, canonical_peer_id)
       VALUES (?, ?, ?, ?)`,
      ["telegram", "work", "123", "bad:peer"],
    );

    const queue = new TelegramChannelQueue(db, {
      agentId: "agent-c1",
      channelKey: "work",
      dmScope: "per_peer",
    });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:dm:123");
  });

  it("defaults telegram account id to default", async () => {
    db = openTestSqliteDb();

    const originalAccountId = process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
    const originalChannelKey = process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    try {
      delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
      delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];

      const queue = new TelegramChannelQueue(db, { agentId: "agent-c1" });
      const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
      const enqueued = await queue.enqueue(normalized);

      expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:default:dm:123");

      const inbox = new ChannelInboxDal(db);
      const row = await inbox.getById(enqueued.inbox.inbox_id);
      expect((row?.payload as { message?: { envelope?: { delivery?: { account?: string } } } })?.message?.envelope?.delivery?.account)
        .toBe("default");
    } finally {
      if (originalAccountId === undefined) {
        delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
      } else {
        process.env["TYRUM_TELEGRAM_ACCOUNT_ID"] = originalAccountId;
      }

      if (originalChannelKey === undefined) {
        delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
      } else {
        process.env["TYRUM_TELEGRAM_CHANNEL_KEY"] = originalChannelKey;
      }
    }
  });

  it("uses canonical group session key taxonomy", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db, { agentId: "agent-c1", channelKey: "work" });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("Group hello", 555, { chatType: "group", senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:group:555");
  });

  it("uses canonical channel session key taxonomy", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db, { agentId: "agent-c1", channelKey: "work" });

    const normalized = normalizeUpdate(
      JSON.stringify(makeTelegramUpdate("announce", 456, { chatType: "channel", senderId: 777 })),
    );
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:channel:456");
  });

  it("isolates dedupe keys per connector account", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db);
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));

    const workAccount = await queue.enqueue(normalized, { accountId: "work" });
    const personalAccount = await queue.enqueue(normalized, { accountId: "personal" });

    expect(workAccount.deduped).toBe(false);
    expect(personalAccount.deduped).toBe(false);
    expect(personalAccount.inbox.inbox_id).not.toBe(workAccount.inbox.inbox_id);
  });

  it("stamps the normalized envelope delivery identity with the queue account id", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db);
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));

    const enqueued = await queue.enqueue(normalized, { accountId: "work" });

    const inbox = new ChannelInboxDal(db);
    const row = await inbox.getById(enqueued.inbox.inbox_id);
    expect((row?.payload as { message?: { envelope?: { delivery?: { account?: string } } } })?.message?.envelope?.delivery?.account)
      .toBe("work");
  });

  it("dedupes default-account messages against legacy source keys", async () => {
    db = openTestSqliteDb();

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));

    const inbox = new ChannelInboxDal(db);
    const legacy = await inbox.enqueue({
      source: "telegram",
      thread_id: normalized.thread.id,
      message_id: normalized.message.id,
      key: "legacy-key",
      lane: "main",
      received_at_ms: Date.now(),
      payload: normalized,
    });

    const queue = new TelegramChannelQueue(db);
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.deduped).toBe(true);
    expect(enqueued.inbox.inbox_id).toBe(legacy.row.inbox_id);
  });

  it("derives account-appropriate thread keys when enqueue overrides account id", async () => {
    db = openTestSqliteDb();
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { chatType: "group" })));

    const defaultQueue = new TelegramChannelQueue(db, { accountId: "default" });
    const workQueue = new TelegramChannelQueue(db, { accountId: "work" });

    const viaOverride = await defaultQueue.enqueue(normalized, { accountId: "work" });
    const viaWorkQueue = await workQueue.enqueue(normalized);

    expect(viaOverride.inbox.key).toBe("agent:default:telegram:work:group:123");
    expect(viaOverride.inbox.key).toBe(viaWorkQueue.inbox.key);
  });

  it("normalizes connector ids when binding no-account egress connectors", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "hello",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const send = vi.fn().mockResolvedValue({ ok: true });
    const processor = new TelegramChannelProcessor({
      db,
      agents: makeAgents(mockRuntime),
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
      egressConnectors: [{ connector: " telegram ", sendMessage: send }],
    });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    await queue.enqueue(normalized);

    await processor.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects connector ids that contain ':' when binding no-account egress connectors", () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "hello",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    expect(
      () =>
        new TelegramChannelProcessor({
          db: db!,
          agents: makeAgents(mockRuntime),
          telegramBot: bot,
          owner: "test-owner",
          debounceMs: 0,
          maxBatch: 1,
          egressConnectors: [{ connector: "telegram:work", sendMessage: vi.fn() }],
        }),
    ).toThrow("connector must not contain ':'");
  });

  it("rejects whitespace-only account ids when binding egress connectors", () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "hello",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    expect(
      () =>
        new TelegramChannelProcessor({
          db: db!,
          agents: makeAgents(mockRuntime),
          telegramBot: bot,
          owner: "test-owner",
          debounceMs: 0,
          maxBatch: 1,
          egressConnectors: [{ connector: "telegram", accountId: "   ", sendMessage: vi.fn() }],
        }),
    ).toThrow(/account must be non-empty/);
  });

  it("uses account-specific egress connectors when provided", async () => {
    db = openTestSqliteDb();
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "I can help with that!",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const defaultSend = vi.fn().mockResolvedValue({ ok: true, account: "default" });
    const workSend = vi.fn().mockResolvedValue({ ok: true, account: "work" });

    const processor = new TelegramChannelProcessor({
      db,
      agents: makeAgents(mockRuntime),
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
      egressConnectors: [
        { connector: "telegram", accountId: "default", sendMessage: defaultSend },
        { connector: "telegram", accountId: "work", sendMessage: workSend },
      ],
    });

    const normalizedDefault = normalizeUpdate(JSON.stringify(makeTelegramUpdate("default", 123, { messageId: 1001 })));
    const normalizedWork = normalizeUpdate(JSON.stringify(makeTelegramUpdate("work", 123, { messageId: 1002 })));

    await queue.enqueue(normalizedDefault, { accountId: "default" });
    await queue.enqueue(normalizedWork, { accountId: "work" });

    await processor.tick();
    await processor.tick();

    expect(defaultSend).toHaveBeenCalledTimes(1);
    expect(workSend).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends agent failure messages via account-specific egress connectors", async () => {
    db = openTestSqliteDb();
    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const mockRuntime = {
      turn: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const workSend = vi.fn().mockResolvedValue({ ok: true, account: "work" });

    const processor = new TelegramChannelProcessor({
      db,
      agents: makeAgents(mockRuntime),
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
      egressConnectors: [{ connector: "telegram", accountId: "work", sendMessage: workSend }],
    });

    const normalizedWork = normalizeUpdate(JSON.stringify(makeTelegramUpdate("work", 123, 3001)));
    await queue.enqueue(normalizedWork, { accountId: "work" });

    await processor.tick();

    expect(workSend).toHaveBeenCalledTimes(1);
    expect(workSend).toHaveBeenCalledWith({
      accountId: "work",
      containerId: "123",
      text: "Sorry, something went wrong. Please try again later.",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("formats connector approval plan ids without extra colons for account-scoped sources", async () => {
    db = openTestSqliteDb();

    const tmp = await mkdtemp(join(tmpdir(), "tyrum-policy-"));
    try {
      const bundlePath = join(tmp, "policy.yml");
      await writeFile(
        bundlePath,
        [
          "v: 1",
          "connectors:",
          "  default: require_approval",
          "  allow: []",
          "  require_approval:",
          "    - \"telegram:*\"",
          "  deny: []",
          "",
        ].join("\n"),
        "utf-8",
      );
      process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;

      const fetchFn = mockFetch();
      const bot = new TelegramBot("test-token", fetchFn);

      const mockRuntime = {
        turn: vi.fn().mockResolvedValue({
          reply: "This requires approval",
          session_id: "session-abc",
          used_tools: [],
          memory_written: false,
        }),
      };

      const approvalDal = new ApprovalDal(db);
      const policyService = new PolicyService({
        home: tmp,
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const queue = new TelegramChannelQueue(db);
      const processor = new TelegramChannelProcessor({
        db,
        agents: {
          getRuntime: async () => mockRuntime,
          getPolicyService: () => policyService,
        } as unknown as AgentRegistry,
        telegramBot: bot,
        owner: "test-owner",
        debounceMs: 0,
        maxBatch: 1,
        approvalDal,
        approvalNotifier: { notify: () => {} },
      });

      const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
      await queue.enqueue(normalized, { accountId: "work" });

      await processor.tick();

      const pending = await approvalDal.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.plan_id).toBe("connector:telegram@work:123:42");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("uses legacy connector policy match targets for default accounts", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "This requires approval",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const evaluateConnectorAction = vi.fn().mockResolvedValue({ decision: "require_approval" });
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction,
    } as unknown as PolicyService;

    const approvalDal = new ApprovalDal(db);

    const processor = new TelegramChannelProcessor({
      db,
      agents: {
        getRuntime: async () => mockRuntime,
        getPolicyService: () => policyService,
      } as unknown as AgentRegistry,
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
      approvalDal,
      approvalNotifier: { notify: () => {} },
    });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    await queue.enqueue(normalized, { accountId: "default" });

    await processor.tick();

    expect(evaluateConnectorAction).toHaveBeenCalledTimes(1);
    expect(evaluateConnectorAction).toHaveBeenCalledWith(
      expect.objectContaining({
        matchTarget: "telegram:123",
      }),
    );
  });

  it("includes account ids in connector policy match targets for non-default accounts", async () => {
    db = openTestSqliteDb();

    const fetchFn = mockFetch();
    const bot = new TelegramBot("test-token", fetchFn);
    const queue = new TelegramChannelQueue(db);

    const mockRuntime = {
      turn: vi.fn().mockResolvedValue({
        reply: "This requires approval",
        session_id: "session-abc",
        used_tools: [],
        memory_written: false,
      }),
    };

    const evaluateConnectorAction = vi.fn().mockResolvedValue({ decision: "require_approval" });
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction,
    } as unknown as PolicyService;

    const approvalDal = new ApprovalDal(db);

    const processor = new TelegramChannelProcessor({
      db,
      agents: {
        getRuntime: async () => mockRuntime,
        getPolicyService: () => policyService,
      } as unknown as AgentRegistry,
      telegramBot: bot,
      owner: "test-owner",
      debounceMs: 0,
      maxBatch: 1,
      approvalDal,
      approvalNotifier: { notify: () => {} },
    });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    await queue.enqueue(normalized, { accountId: "work" });

    await processor.tick();

    expect(evaluateConnectorAction).toHaveBeenCalledTimes(1);
    expect(evaluateConnectorAction).toHaveBeenCalledWith(
      expect.objectContaining({
        matchTarget: "telegram:work:123",
      }),
    );
  });

  it("policy-gates outbound sends via approvals when required", async () => {
    db = openTestSqliteDb();

    const tmp = await mkdtemp(join(tmpdir(), "tyrum-policy-"));
    try {
      const bundlePath = join(tmp, "policy.yml");
      await writeFile(
        bundlePath,
        [
          "v: 1",
          "connectors:",
          "  default: require_approval",
          "  allow: []",
          "  require_approval:",
          "    - \"telegram:*\"",
          "  deny: []",
          "",
        ].join("\n"),
        "utf-8",
      );
      process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;

      const fetchFn = mockFetch();
      const bot = new TelegramBot("test-token", fetchFn);

      const mockRuntime = {
        turn: vi.fn().mockResolvedValue({
          reply: "This requires approval",
          session_id: "session-abc",
          used_tools: [],
          memory_written: false,
        }),
      };

      const approvalDal = new ApprovalDal(db);
      const policyService = new PolicyService({
        home: tmp,
        snapshotDal: new PolicySnapshotDal(db),
        overrideDal: new PolicyOverrideDal(db),
      });

      const queue = new TelegramChannelQueue(db);
      const processor = new TelegramChannelProcessor({
        db,
        agents: {
          getRuntime: async () => mockRuntime,
          getPolicyService: () => policyService,
        } as unknown as AgentRegistry,
        telegramBot: bot,
        owner: "test-owner",
        debounceMs: 0,
        maxBatch: 1,
        approvalDal,
        approvalNotifier: { notify: () => {} },
      });

      const app = new Hono();
      app.route(
        "/",
        createIngressRoutes({
          telegramBot: bot,
          agents: makeAgents(mockRuntime),
          telegramQueue: queue,
        }),
      );

      const res1 = await app.request("/ingress/telegram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": "test-telegram-secret",
        },
        body: JSON.stringify(makeTelegramUpdate("Help me")),
      });

      expect(res1.status).toBe(200);

      await processor.tick();
      expect(fetchFn).not.toHaveBeenCalled();

      const pending = await approvalDal.getPending();
      expect(pending).toHaveLength(1);

      await approvalDal.respond(pending[0]!.id, true);

      await processor.tick();
      expect(fetchFn).toHaveBeenCalledOnce();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
