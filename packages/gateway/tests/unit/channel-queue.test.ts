import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelWorker } from "../../src/modules/channels/worker.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { AgentRuntime } from "../../src/modules/agent/runtime.js";

function mockTelegramFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"ok":true}'),
    json: () => Promise.resolve({ ok: true }),
  }) as unknown as typeof fetch;
}

describe("channel inbound queue (cap/overflow + queue modes)", () => {
  let db: SqliteDb | undefined;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("ChannelInboxDal drop_newest drops the newly enqueued message when cap exceeded", async () => {
    const dal = new ChannelInboxDal(db!);

    const base = {
      channel: "telegram",
      accountId: "default",
      containerId: "c1",
      threadKind: "private",
      senderId: "u1",
      senderIsBot: false,
      provenance: ["user"] as const,
      hasAttachment: false,
    };

    const first = await dal.enqueueMessage(
      {
        ...base,
        messageId: "m1",
        text: "one",
        receivedAtMs: 1,
      },
      { cap: 1, overflow: "drop_newest" },
    );
    expect(first.kind).toBe("queued");

    const second = await dal.enqueueMessage(
      {
        ...base,
        messageId: "m2",
        text: "two",
        receivedAtMs: 2,
      },
      { cap: 1, overflow: "drop_newest" },
    );

    expect(second.kind).toBe("dropped");
    if (second.kind === "dropped") {
      expect(second.dropped).toBe(1);
      expect(second.overflowPolicy).toBe("drop_newest");
    }

    const pending = await db!.all<{ message_id: string; status: string }>(
      `SELECT message_id, status FROM channel_inbound_messages
       WHERE channel = ? AND account_id = ? AND container_id = ?
       ORDER BY received_at_ms ASC`,
      ["telegram", "default", "c1"],
    );
    expect(pending).toEqual([
      { message_id: "m1", status: "pending" },
      { message_id: "m2", status: "dropped" },
    ]);
  });

  it("ChannelInboxDal summarize_dropped rewrites the surviving message with a dropped summary", async () => {
    const dal = new ChannelInboxDal(db!);

    const base = {
      channel: "telegram",
      accountId: "default",
      containerId: "c2",
      threadKind: "private",
      senderId: "u1",
      senderIsBot: false,
      provenance: ["user"] as const,
      hasAttachment: false,
    };

    await dal.enqueueMessage(
      {
        ...base,
        messageId: "m1",
        text: "hello one",
        receivedAtMs: 1,
      },
      { cap: 1, overflow: "summarize_dropped" },
    );

    const second = await dal.enqueueMessage(
      {
        ...base,
        messageId: "m2",
        text: "hello two",
        receivedAtMs: 2,
      },
      { cap: 1, overflow: "summarize_dropped", summarizeMaxChars: 2000 },
    );

    expect(second.kind).toBe("queued");
    if (second.kind === "queued") {
      expect(second.dropped).toBe(1);
      expect(second.overflowPolicy).toBe("summarize_dropped");
      expect(second.summarized).toBe(true);
    }

    const rows = await db!.all<{ message_id: string; status: string; text: string | null }>(
      `SELECT message_id, status, text FROM channel_inbound_messages
       WHERE channel = ? AND account_id = ? AND container_id = ?
       ORDER BY received_at_ms ASC`,
      ["telegram", "default", "c2"],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("dropped");
    expect(rows[1]?.status).toBe("pending");
    expect(String(rows[1]?.text)).toContain("[QUEUE OVERFLOW]");
    expect(String(rows[1]?.text)).toContain("Dropped 1 message(s)");
    expect(String(rows[1]?.text)).toContain("hello one");
    expect(String(rows[1]?.text)).toContain("Newest message");
    expect(String(rows[1]?.text)).toContain("hello two");
  });

  it("ChannelWorker followup mode processes each message as a separate turn", async () => {
    const memoryDal = new MemoryDal(db!);
    const approvalDal = new ApprovalDal(db!);
    const fetchFn = mockTelegramFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const runtime = {
      turn: vi.fn(async (req) => ({
        reply: `R:${req.message}`,
        session_id: "sess-1",
        used_tools: [],
        memory_written: false,
      })),
    } as unknown as AgentRuntime;

    const worker = new ChannelWorker({
      db: db!,
      memoryDal,
      approvalDal,
      agentRuntime: runtime,
      telegramBot: bot,
      debounceMs: 0,
      tickMs: 10_000,
      queueMode: "followup",
    });

    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "123",
      messageId: "1",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "first",
      hasAttachment: false,
      receivedAtMs: 1,
    });
    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "123",
      messageId: "2",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "second",
      hasAttachment: false,
      receivedAtMs: 2,
    });

    await worker.tick();

    expect(runtime.turn).toHaveBeenCalledTimes(2);
    expect((runtime.turn as ReturnType<typeof vi.fn>).mock.calls[0]![0].message).toBe("first");
    expect((runtime.turn as ReturnType<typeof vi.fn>).mock.calls[1]![0].message).toBe("second");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("ChannelWorker interrupt mode drops backlog and processes only the newest message", async () => {
    const memoryDal = new MemoryDal(db!);
    const approvalDal = new ApprovalDal(db!);
    const fetchFn = mockTelegramFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const runtime = {
      turn: vi.fn(async (req) => ({
        reply: `R:${req.message}`,
        session_id: "sess-1",
        used_tools: [],
        memory_written: false,
      })),
    } as unknown as AgentRuntime;

    const worker = new ChannelWorker({
      db: db!,
      memoryDal,
      approvalDal,
      agentRuntime: runtime,
      telegramBot: bot,
      debounceMs: 0,
      tickMs: 10_000,
      queueMode: "interrupt",
    });

    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "456",
      messageId: "1",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "first",
      hasAttachment: false,
      receivedAtMs: 1,
    });
    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "456",
      messageId: "2",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "second",
      hasAttachment: false,
      receivedAtMs: 2,
    });
    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "456",
      messageId: "3",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "third",
      hasAttachment: false,
      receivedAtMs: 3,
    });

    await worker.tick();

    expect(runtime.turn).toHaveBeenCalledTimes(1);
    expect((runtime.turn as ReturnType<typeof vi.fn>).mock.calls[0]![0].message).toBe("third");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const rows = await db!.all<{ message_id: string; status: string }>(
      `SELECT message_id, status FROM channel_inbound_messages
       WHERE channel = ? AND account_id = ? AND container_id = ?
       ORDER BY received_at_ms ASC`,
      ["telegram", "default", "456"],
    );
    expect(rows.map((r) => ({ id: r.message_id, status: r.status }))).toEqual([
      { id: "1", status: "dropped" },
      { id: "2", status: "dropped" },
      { id: "3", status: "completed" },
    ]);
  });

  it("ChannelWorker steer_backlog prioritizes newest, then collects the backlog", async () => {
    const memoryDal = new MemoryDal(db!);
    const approvalDal = new ApprovalDal(db!);
    const fetchFn = mockTelegramFetch();
    const bot = new TelegramBot("test-token", fetchFn);

    const runtime = {
      turn: vi.fn(async (req) => ({
        reply: `R:${req.message}`,
        session_id: "sess-1",
        used_tools: [],
        memory_written: false,
      })),
    } as unknown as AgentRuntime;

    const worker = new ChannelWorker({
      db: db!,
      memoryDal,
      approvalDal,
      agentRuntime: runtime,
      telegramBot: bot,
      debounceMs: 0,
      tickMs: 10_000,
      queueMode: "steer_backlog",
    });

    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "789",
      messageId: "1",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "first",
      hasAttachment: false,
      receivedAtMs: 1,
    });
    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "789",
      messageId: "2",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "second",
      hasAttachment: false,
      receivedAtMs: 2,
    });
    await worker.enqueueTelegramInbound({
      accountId: "default",
      containerId: "789",
      messageId: "3",
      threadKind: "private",
      senderId: "999",
      senderIsBot: false,
      provenance: ["user"],
      text: "third",
      hasAttachment: false,
      receivedAtMs: 3,
    });

    await worker.tick();

    expect(runtime.turn).toHaveBeenCalledTimes(2);
    expect((runtime.turn as ReturnType<typeof vi.fn>).mock.calls[0]![0].message).toBe("third");
    expect((runtime.turn as ReturnType<typeof vi.fn>).mock.calls[1]![0].message).toBe("first\nsecond");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

