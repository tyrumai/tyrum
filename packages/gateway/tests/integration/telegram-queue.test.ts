import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { TelegramChannelProcessor, TelegramChannelQueue } from "../../src/modules/channels/telegram.js";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
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

    expect(mockRuntime.turn).toHaveBeenCalledWith({
      channel: "telegram",
      thread_id: "123",
      message: "Help me",
    });
    expect(fetchFn).toHaveBeenCalledOnce();

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

  it("uses canonical dm session key taxonomy by default", async () => {
    db = openTestSqliteDb();
    const queue = new TelegramChannelQueue(db, { agentId: "agent-c1", channelKey: "work" });

    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
    const enqueued = await queue.enqueue(normalized);

    expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:work:dm:123");
  });

  it("defaults telegram account id to legacy channel key", async () => {
    db = openTestSqliteDb();

    const originalAccountId = process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
    const originalChannelKey = process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];
    try {
      delete process.env["TYRUM_TELEGRAM_ACCOUNT_ID"];
      delete process.env["TYRUM_TELEGRAM_CHANNEL_KEY"];

      const queue = new TelegramChannelQueue(db, { agentId: "agent-c1" });
      const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me", 123, { senderId: 777 })));
      const enqueued = await queue.enqueue(normalized);

      expect(enqueued.inbox.key).toBe("agent:agent-c1:telegram:telegram-1:dm:123");
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
