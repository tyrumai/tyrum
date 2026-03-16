import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import {
  TelegramChannelProcessor,
  TelegramChannelQueue,
} from "../../src/modules/channels/telegram.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import * as commandSupport from "./command-session-primitives.test-support.js";
import {
  createPromptAwareLanguageModel,
  extractPromptSection,
  makeTelegramDmMessage,
  promptIncludes,
} from "./agent-behavior.test-support.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

function makeRuntimeConfig(input?: { memoryEnabled?: boolean }): Record<string, unknown> {
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        memory: input?.memoryEnabled
          ? {
              enabled: true,
              keyword: { enabled: true, limit: 20 },
              semantic: { enabled: false, limit: 1 },
              structured: { fact_keys: [], tags: [] },
              budgets: {
                max_total_items: 10,
                max_total_chars: 4000,
                per_kind: {
                  fact: { max_items: 4, max_chars: 1200 },
                  note: { max_items: 6, max_chars: 2400 },
                  procedure: { max_items: 2, max_chars: 1200 },
                  episode: { max_items: 4, max_chars: 1600 },
                },
              },
            }
          : { enabled: false },
      },
    },
    tools: { default_mode: "allow" },
    sessions: { ttl_days: 30, max_turns: 20 },
  };
}

function noteDecision(body_md: string) {
  return {
    should_store: true as const,
    reason: "Durable user-provided information.",
    memory: {
      kind: "note" as const,
      body_md,
    },
  };
}

describe("Agent behavior - session boundaries", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("isolates DM session recall by thread when no durable memory is enabled", async () => {
    ({ homeDir, container } = await setupTestEnv());
    await seedAgentConfig(container, { config: makeRuntimeConfig() });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what is my name")) {
          return /my name is alice/iu.test(promptText) ? "Alice" : "UNKNOWN";
        }
        return "ok";
      }),
      fetchImpl: fetch404,
    });

    const aliceIntro = makeTelegramDmMessage({
      threadId: "dm-alice",
      messageId: "dm-alice-1",
      text: "my name is Alice",
    });
    await runtime.turn({
      channel: "telegram",
      thread_id: "dm-alice",
      message: "my name is Alice",
      envelope: aliceIntro.message.envelope,
    });

    const sameDm = await runtime.turn({
      channel: "telegram",
      thread_id: "dm-alice",
      message: "what is my name?",
      envelope: makeTelegramDmMessage({
        threadId: "dm-alice",
        messageId: "dm-alice-2",
        text: "what is my name?",
      }).message.envelope,
    });
    const differentDm = await runtime.turn({
      channel: "telegram",
      thread_id: "dm-bob",
      message: "what is my name?",
      envelope: makeTelegramDmMessage({
        threadId: "dm-bob",
        messageId: "dm-bob-1",
        text: "what is my name?",
      }).message.envelope,
    });

    expect(sameDm.reply).toBe("Alice");
    expect(differentDm.reply).toBe("UNKNOWN");
  });

  it("canonicalizes per-peer Telegram DM keys through peer identity links", async () => {
    const db = openTestSqliteDb();
    try {
      await db.run(
        `INSERT INTO peer_identity_links (tenant_id, channel, account, provider_peer_id, canonical_peer_id)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, "telegram", "default", "peer-a", "canon-1"],
      );
      await db.run(
        `INSERT INTO peer_identity_links (tenant_id, channel, account, provider_peer_id, canonical_peer_id)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, "telegram", "default", "peer-b", "canon-1"],
      );

      const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
      const queue = new TelegramChannelQueue(db, {
        sessionDal,
        agentId: "default",
        accountId: "default",
        dmScope: "per_peer",
      });

      const first = await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "peer-a",
          messageId: "canon-a",
          text: "hello from A",
        }),
      );
      const second = await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "peer-b",
          messageId: "canon-b",
          text: "hello from B",
        }),
      );

      expect(first.inbox.key).toBe("agent:default:dm:canon-1");
      expect(second.inbox.key).toBe(first.inbox.key);
    } finally {
      await db.close();
    }
  });

  it("batches collect-mode corrections into one durable outcome", async () => {
    const db = openTestSqliteDb();
    try {
      const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
      const queue = new TelegramChannelQueue(db, {
        sessionDal,
        agentId: "default",
        accountId: "default",
      });
      const turnCalls: Array<string | undefined> = [];

      await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "collect-chat",
          messageId: "collect-1",
          text: "Book Tuesday",
        }),
        { queueMode: "collect" },
      );
      await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "collect-chat",
          messageId: "collect-2",
          text: "Actually Wednesday",
        }),
        { queueMode: "collect" },
      );

      const agents = {
        getRuntime: vi.fn(async () => ({
          turn: vi.fn(async (req: { message?: string }) => {
            turnCalls.push(req.message);
            return {
              reply: req.message?.includes("Wednesday")
                ? "Scheduled for Wednesday"
                : "Scheduled for Tuesday",
              session_id: "session-1",
              used_tools: [],
              memory_written: false,
            };
          }),
        })),
      };
      const telegramBot = {
        sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
      };

      const processor = new TelegramChannelProcessor({
        db,
        agents: agents as never,
        telegramBot: telegramBot as never,
        owner: "worker-1",
        debounceMs: 1_000,
        maxBatch: 5,
      });

      await processor.tick();

      expect(turnCalls).toEqual(["Book Tuesday\n\nActually Wednesday"]);
      expect(telegramBot.sendMessage).toHaveBeenCalledTimes(1);
      expect(telegramBot.sendMessage).toHaveBeenCalledWith(
        "collect-chat",
        "Scheduled for Wednesday",
        expect.anything(),
      );
    } finally {
      await db.close();
    }
  });

  it("interrupt mode drops the stale queued intent and processes only the correction", async () => {
    const db = openTestSqliteDb();
    try {
      const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
      const queue = new TelegramChannelQueue(db, {
        sessionDal,
        agentId: "default",
        accountId: "default",
      });
      const turnCalls: Array<string | undefined> = [];

      const first = await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "interrupt-chat",
          messageId: "interrupt-1",
          text: "Book Tuesday",
        }),
        { queueMode: "collect" },
      );

      await db.run(
        `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, first.inbox.key, "main", "worker-1", Date.now() + 60_000],
      );

      const second = await queue.enqueue(
        makeTelegramDmMessage({
          threadId: "interrupt-chat",
          messageId: "interrupt-2",
          text: "Actually Wednesday",
        }),
        { queueMode: "interrupt" },
      );

      const queuedRows = await db.all<{ message_id: string }>(
        `SELECT message_id
         FROM channel_inbox
         WHERE key = ? AND lane = ? AND status = 'queued'
         ORDER BY inbox_id ASC`,
        [first.inbox.key, "main"],
      );
      const signal = await db.get<{ kind: string; message_text: string }>(
        `SELECT kind, message_text
         FROM lane_queue_signals
         WHERE tenant_id = ? AND key = ? AND lane = ?`,
        [DEFAULT_TENANT_ID, first.inbox.key, "main"],
      );

      expect(second.deduped).toBe(false);
      expect(queuedRows).toEqual([{ message_id: "interrupt-2" }]);
      expect(signal).toMatchObject({ kind: "interrupt", message_text: "Actually Wednesday" });

      await db.run(`DELETE FROM lane_leases WHERE tenant_id = ? AND key = ? AND lane = ?`, [
        DEFAULT_TENANT_ID,
        first.inbox.key,
        "main",
      ]);

      const agents = {
        getRuntime: vi.fn(async () => ({
          turn: vi.fn(async (req: { message?: string }) => {
            turnCalls.push(req.message);
            return {
              reply: req.message?.includes("Wednesday")
                ? "Scheduled for Wednesday"
                : "Scheduled for Tuesday",
              session_id: "session-1",
              used_tools: [],
              memory_written: false,
            };
          }),
        })),
      };
      const telegramBot = {
        sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
      };

      const processor = new TelegramChannelProcessor({
        db,
        agents: agents as never,
        telegramBot: telegramBot as never,
        owner: "worker-1",
        debounceMs: 0,
        maxBatch: 5,
      });

      await processor.tick();

      expect(turnCalls).toEqual(["Actually Wednesday"]);
      expect(telegramBot.sendMessage).toHaveBeenCalledWith(
        "interrupt-chat",
        "Scheduled for Wednesday",
        expect.anything(),
      );
    } finally {
      await db.close();
    }
  });

  it("does not reconstruct cleared session context from retained channel logs", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const session = await commandSupport.ensureSession(container.db, {
      agentKey: "default",
      channel: "telegram",
      threadId: "repair-thread",
      containerKind: "channel",
    });
    await commandSupport.seedTelegramRepairTurn(container.db, {
      session,
      threadId: "repair-thread",
      messageId: "repair-1",
      userText: "user-one",
      assistantText: "assistant-one",
      receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
    });
    await commandSupport.writeSessionState(container.db, session, { summary: "", turns: [] });
    await seedAgentConfig(container, { config: makeRuntimeConfig() });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(({ promptText }) => {
        if (promptIncludes(promptText, "what did i say earlier")) {
          return /user-one/iu.test(promptText) ? "user-one" : "UNKNOWN";
        }
        return "ok";
      }),
      fetchImpl: fetch404,
    });

    const repaired = await runtime.turn({
      channel: "telegram",
      thread_id: "repair-thread",
      message: "what did I say earlier?",
    });

    expect(repaired.reply).toBe("UNKNOWN");
  });

  it("dedupes duplicate inbound deliveries down to one turn and one side effect", async () => {
    const db = openTestSqliteDb();
    try {
      const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
      const queue = new TelegramChannelQueue(db, {
        sessionDal,
        agentId: "default",
        accountId: "default",
      });
      const turnCalls: Array<string | undefined> = [];

      const normalized = makeTelegramDmMessage({
        threadId: "dedupe-chat",
        messageId: "dedupe-1",
        text: "hello once",
      });
      const first = await queue.enqueue(normalized, { queueMode: "collect" });
      const second = await queue.enqueue(normalized, { queueMode: "collect" });

      const agents = {
        getRuntime: vi.fn(async () => ({
          turn: vi.fn(async (req: { message?: string }) => {
            turnCalls.push(req.message);
            return {
              reply: "processed once",
              session_id: "session-1",
              used_tools: [],
              memory_written: false,
            };
          }),
        })),
      };
      const telegramBot = {
        sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
      };

      const processor = new TelegramChannelProcessor({
        db,
        agents: agents as never,
        telegramBot: telegramBot as never,
        owner: "worker-1",
        debounceMs: 0,
        maxBatch: 5,
      });

      await processor.tick();

      const inboxCount = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM channel_inbox
         WHERE key = ? AND lane = ?`,
        [first.inbox.key, "main"],
      );

      expect(second.deduped).toBe(true);
      expect(turnCalls).toEqual(["hello once"]);
      expect(telegramBot.sendMessage).toHaveBeenCalledTimes(1);
      expect(inboxCount?.n).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("keeps durable memory isolated across tenants", async () => {
    ({ homeDir, container } = await setupTestEnv());
    const scopeA = await container.identityScopeDal.resolveScopeIds({ tenantKey: "tenant-a" });
    const scopeB = await container.identityScopeDal.resolveScopeIds({ tenantKey: "tenant-b" });

    await seedAgentConfig(container, {
      tenantKey: "tenant-a",
      config: makeRuntimeConfig({ memoryEnabled: true }),
    });
    await seedAgentConfig(container, {
      tenantKey: "tenant-b",
      config: makeRuntimeConfig({ memoryEnabled: true }),
    });

    const model = createPromptAwareLanguageModel(
      ({ promptText }) => {
        if (promptIncludes(promptText, "what is my name")) {
          return /my name is alice/iu.test(extractPromptSection(promptText, "Memory digest:"))
            ? "Alice"
            : "UNKNOWN";
        }
        return "Stored.";
      },
      {
        memoryDecision: ({ latestUserText }) =>
          promptIncludes(latestUserText, "remember that my name is alice")
            ? noteDecision("remember that my name is Alice")
            : undefined,
      },
    );

    const runtimeA = new AgentRuntime({
      container,
      home: homeDir,
      tenantId: scopeA.tenantId,
      languageModel: model,
      fetchImpl: fetch404,
    });
    const runtimeB = new AgentRuntime({
      container,
      home: homeDir,
      tenantId: scopeB.tenantId,
      languageModel: model,
      fetchImpl: fetch404,
    });

    await runtimeA.turn({
      channel: "ui",
      thread_id: "tenant-a-thread",
      message: "remember that my name is Alice",
    });
    const tenantBRecall = await runtimeB.turn({
      channel: "ui",
      thread_id: "tenant-b-thread",
      message: "what is my name?",
    });

    expect(tenantBRecall.reply).toBe("UNKNOWN");

    const tenantAMemory = await container.memoryDal.list({
      tenantId: scopeA.tenantId,
      agentId: scopeA.agentId,
    });
    const tenantBMemory = await container.memoryDal.list({
      tenantId: scopeB.tenantId,
      agentId: scopeB.agentId,
    });

    expect(tenantAMemory.items).toHaveLength(1);
    expect(tenantBMemory.items).toHaveLength(0);
  });
});
