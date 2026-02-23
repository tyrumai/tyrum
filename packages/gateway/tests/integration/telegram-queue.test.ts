import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import {
  TelegramChannelProcessor,
  TelegramChannelQueue,
  telegramThreadKey,
} from "../../src/modules/channels/telegram.js";
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

function makeTelegramUpdate(text: string, chatId = 123) {
  return {
    update_id: 100,
    message: {
      message_id: 42,
      date: 1700000000,
      from: { id: 999, is_bot: false, first_name: "Alice" },
      chat: { id: chatId, type: "private" },
      text,
    },
  };
}

function makeNormalizedUpdate(opts: {
  threadId: string;
  threadKind: "private" | "group" | "supergroup" | "channel" | "other";
  messageId: string;
  text: string;
}) {
  return {
    thread: {
      id: opts.threadId,
      kind: opts.threadKind,
      pii_fields: [],
    },
    message: {
      id: opts.messageId,
      thread_id: opts.threadId,
      source: "telegram" as const,
      content: { kind: "text" as const, text: opts.text },
      timestamp: new Date().toISOString(),
      pii_fields: [],
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

  beforeEach(() => {
    process.env["TELEGRAM_WEBHOOK_SECRET"] = "test-telegram-secret";
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

  it("uses DM key shape for private Telegram chats", async () => {
    db = openTestSqliteDb();

    const queue = new TelegramChannelQueue(db, {
      agentId: "agent-1",
      channelKey: "telegram",
    });

    const enqueued = await queue.enqueue(
      makeNormalizedUpdate({
        threadId: "123",
        threadKind: "private",
        messageId: "m-private-1",
        text: "Help me",
      }),
    );

    expect(enqueued.inbox.key).toBe("agent:agent-1:telegram:dm:123");
  });

  it("uses channel key shape for Telegram channel posts", async () => {
    db = openTestSqliteDb();

    const queue = new TelegramChannelQueue(db, {
      agentId: "agent-1",
      channelKey: "telegram",
    });

    const enqueued = await queue.enqueue(
      makeNormalizedUpdate({
        threadId: "456",
        threadKind: "channel",
        messageId: "m-channel-1",
        text: "announce",
      }),
    );

    expect(enqueued.inbox.key).toBe("agent:agent-1:telegram:channel:456");
  });

  it("requires explicit thread kind for string thread ids", () => {
    expect(() =>
      telegramThreadKey("789", { agentId: "agent-1", channelKey: "telegram" }),
    ).toThrow("thread kind is required");

    expect(
      telegramThreadKey("789", {
        agentId: "agent-1",
        channelKey: "telegram",
        threadKind: "private",
      }),
    ).toBe("agent:agent-1:telegram:dm:789");
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
