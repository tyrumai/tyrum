import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { NormalizedThreadMessage } from "@tyrum/schemas";

function makeNormalizedTextMessage(input: {
  threadId: string;
  messageId: string;
  text: string;
}): NormalizedThreadMessage {
  const nowIso = new Date().toISOString();
  return {
    thread: {
      id: input.threadId,
      kind: "private",
      title: undefined,
      username: undefined,
      pii_fields: [],
    },
    message: {
      id: input.messageId,
      thread_id: input.threadId,
      source: "telegram",
      content: { kind: "text", text: input.text },
      sender: {
        id: "peer-1",
        is_bot: false,
        username: "peer",
      },
      timestamp: nowIso,
      edited_timestamp: undefined,
      pii_fields: ["message_text"],
      envelope: {
        message_id: input.messageId,
        received_at: nowIso,
        delivery: { channel: "telegram", account: "default" },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

describe("Telegram channel queue modes", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let inbox: ChannelInboxDal;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    inbox = new ChannelInboxDal(db);
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("batches collect-mode messages into one turn", async () => {
    const turnCalls: Array<{ message: string | undefined }> = [];

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async (req: { message?: string }) => {
          turnCalls.push({ message: req.message });
          return {
            reply: req.message ?? "",
            session_id: "session-1",
            used_tools: [],
            memory_written: false,
          };
        }),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      queue_mode: "collect",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "one",
      }),
    });

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-2",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_500,
      queue_mode: "collect",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-2",
        text: "two",
      }),
    });

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 1_000,
      maxBatch: 5,
    });

    await processor.tick();

    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]?.message).toBe("one\n\ntwo");
  });

  it("treats invalid queue_mode values as collect (so batching is preserved)", async () => {
    const turnCalls: Array<{ message: string | undefined }> = [];

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async (req: { message?: string }) => {
          turnCalls.push({ message: req.message });
          return {
            reply: req.message ?? "",
            session_id: "session-1",
            used_tools: [],
            memory_written: false,
          };
        }),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      queue_mode: "not-a-real-mode",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "one",
      }),
    });

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-2",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_500,
      queue_mode: "not-a-real-mode",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-2",
        text: "two",
      }),
    });

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 1_000,
      maxBatch: 5,
    });

    await processor.tick();

    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]?.message).toBe("one\n\ntwo");
  });

  it("does not batch followup-mode messages", async () => {
    const turnCalls: Array<{ message: string | undefined }> = [];

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async (req: { message?: string }) => {
          turnCalls.push({ message: req.message });
          return {
            reply: req.message ?? "",
            session_id: "session-1",
            used_tools: [],
            memory_written: false,
          };
        }),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      queue_mode: "followup",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "one",
      }),
    });

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-2",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_500,
      queue_mode: "followup",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-2",
        text: "two",
      }),
    });

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 1_000,
      maxBatch: 5,
    });

    await processor.tick();
    await processor.tick();

    expect(turnCalls).toHaveLength(2);
    expect(turnCalls[0]?.message).toBe("one");
    expect(turnCalls[1]?.message).toBe("two");
  });

  it("does not sweep followup messages into a collect batch", async () => {
    const turnCalls: Array<{ message: string | undefined }> = [];

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async (req: { message?: string }) => {
          turnCalls.push({ message: req.message });
          return {
            reply: req.message ?? "",
            session_id: "session-1",
            used_tools: [],
            memory_written: false,
          };
        }),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      queue_mode: "collect",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "one",
      }),
    });

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-2",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_500,
      queue_mode: "followup",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-2",
        text: "two",
      }),
    });

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 1_000,
      maxBatch: 5,
    });

    await processor.tick();

    expect(turnCalls).toHaveLength(1);
    expect(turnCalls[0]?.message).toBe("one");

    await processor.tick();

    expect(turnCalls).toHaveLength(2);
    expect(turnCalls[1]?.message).toBe("two");
  });
});
