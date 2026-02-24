import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelQueue } from "../../src/modules/channels/telegram.js";
import { WsEventEnvelope, WsEvent } from "@tyrum/schemas";
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

describe("Channel inbox queue overflow policies", () => {
  const originalCap = process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"];
  const originalOverflow = process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"];

  let db: SqliteDb;
  let inbox: ChannelInboxDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    inbox = new ChannelInboxDal(db);
  });

  afterEach(async () => {
    if (originalCap === undefined) {
      delete process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"];
    } else {
      process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = originalCap;
    }

    if (originalOverflow === undefined) {
      delete process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"];
    } else {
      process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = originalOverflow;
    }

    await db.close();
  });

  it("drop_oldest completes the oldest queued rows when cap is exceeded", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "2";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "drop_oldest";

    const key = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane: "main",
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-2",
      key,
      lane: "main",
      received_at_ms: 2_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-3",
      key,
      lane: "main",
      received_at_ms: 3_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-3", text: "three" }),
    });

    const rows = await db.all<{ message_id: string; status: string }>(
      "SELECT message_id, status FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    expect(rows.map((r) => [r.message_id, r.status])).toEqual([
      ["msg-1", "completed"],
      ["msg-2", "queued"],
      ["msg-3", "queued"],
    ]);
  });

  it("drop_newest completes the newest queued rows when cap is exceeded", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "2";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "drop_newest";

    const key = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane: "main",
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-2",
      key,
      lane: "main",
      received_at_ms: 2_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-3",
      key,
      lane: "main",
      received_at_ms: 3_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-3", text: "three" }),
    });

    const rows = await db.all<{ message_id: string; status: string }>(
      "SELECT message_id, status FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    expect(rows.map((r) => [r.message_id, r.status])).toEqual([
      ["msg-1", "queued"],
      ["msg-2", "queued"],
      ["msg-3", "completed"],
    ]);
  });

  it("summarize_dropped replaces overflow with a synthetic follow-up message", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "2";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "summarize_dropped";

    const key = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane: "main",
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-2",
      key,
      lane: "main",
      received_at_ms: 2_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-3",
      key,
      lane: "main",
      received_at_ms: 3_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-3", text: "three" }),
    });

    const rows = await db.all<{ message_id: string; status: string; payload_json: string }>(
      "SELECT message_id, status, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();
    expect(synthetic?.status).toBe("queued");

    const payload = JSON.parse(synthetic!.payload_json) as { message?: { content?: { text?: string } } };
    expect(payload.message?.content?.text ?? "").toContain("Queue overflow");
    expect(payload.message?.content?.text ?? "").toContain("one");

    const rowStates = rows.map((r) => [r.message_id.startsWith("queue_overflow:") ? "synthetic" : r.message_id, r.status]);
    expect(rowStates).toEqual([
      ["msg-1", "completed"],
      ["msg-2", "completed"],
      ["synthetic", "queued"],
      ["msg-3", "queued"],
    ]);
  });

  it("emits a WS event when overflow occurs (telegram queue)", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "1";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "drop_newest";

    const send = vi.fn();
    const ws = {
      connectionManager: {
        allClients: () => [{ ws: { send } }],
      },
    };

    const queue = new TelegramChannelQueue(db, {
      agentId: "default",
      accountId: "default",
      lane: "main",
      dmScope: "per_account_channel_peer",
      ws,
    });

    await queue.enqueue(
      makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
      { queueMode: "followup" },
    );
    await queue.enqueue(
      makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
      { queueMode: "followup" },
    );

    expect(send).toHaveBeenCalledTimes(1);
    const raw = send.mock.calls[0]?.[0];
    const parsed = WsEventEnvelope.safeParse(JSON.parse(String(raw)));
    expect(parsed.success).toBe(true);
    expect(parsed.data.type).toBe("channel.queue.overflow");
    const typed = WsEvent.safeParse(parsed.data);
    expect(typed.success).toBe(true);
  });

  it("normalizes invalid lane values so overflow events are not dropped", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "1";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "drop_newest";

    const send = vi.fn();
    const ws = {
      connectionManager: {
        allClients: () => [{ ws: { send } }],
      },
    };

    const queue = new TelegramChannelQueue(db, {
      agentId: "default",
      accountId: "default",
      lane: "not-a-real-lane",
      dmScope: "per_account_channel_peer",
      ws,
    });

    await queue.enqueue(
      makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
      { queueMode: "followup" },
    );
    await queue.enqueue(
      makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
      { queueMode: "followup" },
    );

    expect(send).toHaveBeenCalledTimes(1);
    const raw = send.mock.calls[0]?.[0];
    const parsed = WsEventEnvelope.safeParse(JSON.parse(String(raw)));
    expect(parsed.success).toBe(true);
    expect(parsed.data.type).toBe("channel.queue.overflow");
    expect((parsed.data.payload as { lane?: string }).lane).toBe("main");
  });
});
