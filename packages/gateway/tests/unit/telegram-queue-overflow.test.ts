import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { RunResult, SqlDb } from "../../src/statestore/types.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelQueue } from "../../src/modules/channels/telegram.js";
import { WsEventEnvelope, WsEvent } from "@tyrum/schemas";
import type { NormalizedThreadMessage } from "@tyrum/schemas";

function makeNormalizedTextMessage(input: {
  threadId: string;
  messageId: string;
  text: string;
  accountId?: string;
}): NormalizedThreadMessage {
  const nowIso = new Date().toISOString();
  const accountId = input.accountId ?? "default";
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
        delivery: { channel: "telegram", account: accountId },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

function makeLegacyMediaPlaceholderMessage(input: {
  threadId: string;
  messageId: string;
  caption?: string;
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
      content: { kind: "media_placeholder", media_kind: "photo", caption: input.caption },
      timestamp: nowIso,
      pii_fields: input.caption ? ["message_caption"] : [],
    },
  };
}

class InjectingOverflowDb implements SqlDb {
  readonly kind: SqlDb["kind"];

  private injected = false;

  constructor(
    private readonly db: SqlDb,
    private readonly injection: {
      key: string;
      lane: string;
      source: string;
      threadId: string;
      messageId: string;
      receivedAtMs: number;
      payload: NormalizedThreadMessage;
    },
  ) {
    this.kind = db.kind;
  }

  async get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
    return await this.db.get(sql, params);
  }

  async all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return await this.db.all(sql, params);
  }

  async run(sql: string, params?: readonly unknown[]): Promise<RunResult> {
    return await this.db.run(sql, params);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    return await this.db.transaction(async (tx) => await fn(this.wrapTx(tx)));
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private wrapTx(tx: SqlDb): SqlDb {
    return {
      kind: tx.kind,
      get: async <T>(sql: string, params?: readonly unknown[]) => await tx.get<T>(sql, params),
      all: async <T>(sql: string, params?: readonly unknown[]) => await tx.all<T>(sql, params),
      run: async (sql: string, params?: readonly unknown[]) => {
        const result = await tx.run(sql, params);

        if (
          !this.injected
          && result.changes === 1
          && sql.includes("UPDATE channel_inbox")
          && sql.includes("SET status = 'completed'")
        ) {
          this.injected = true;
          await tx.run(
            `INSERT INTO channel_inbox (
               source,
               thread_id,
               message_id,
               key,
               lane,
               queue_mode,
               received_at_ms,
               payload_json,
               status
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
            [
              this.injection.source,
              this.injection.threadId,
              this.injection.messageId,
              this.injection.key,
              this.injection.lane,
              "followup",
              this.injection.receivedAtMs,
              JSON.stringify(this.injection.payload),
            ],
          );
        }

        return result;
      },
      exec: async (sql: string) => await tx.exec(sql),
      transaction: async <T>(fn: (inner: SqlDb) => Promise<T>) =>
        await tx.transaction(async (inner) => await fn(this.wrapTx(inner))),
      close: async () => await tx.close(),
    } satisfies SqlDb;
  }
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

  it("enforces cap when the queue grows during trimming (simulated concurrency)", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "1";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "drop_oldest";

    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

    const injectingDb = new InjectingOverflowDb(db, {
      key,
      lane,
      source: "telegram",
      threadId: "chat-1",
      messageId: "msg-injected",
      receivedAtMs: 1_500,
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-injected",
        text: "injected",
      }),
    });

    inbox = new ChannelInboxDal(injectingDb);

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane,
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "msg-2",
      key,
      lane,
      received_at_ms: 2_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two" }),
    });

    const queued = await db.all<{ message_id: string }>(
      `SELECT message_id
       FROM channel_inbox
       WHERE status = 'queued' AND key = ? AND lane = ?
       ORDER BY received_at_ms ASC, inbox_id ASC`,
      [key, lane],
    );

    expect(queued.map((row) => row.message_id)).toEqual(["msg-2"]);
  });

  it("summarize_dropped includes attachment counts for legacy media placeholders without envelopes", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "1";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "summarize_dropped";

    const key = "agent:default:telegram:default:dm:chat-1";

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "media-1",
      key,
      lane: "main",
      received_at_ms: 1_000,
      payload: makeLegacyMediaPlaceholderMessage({ threadId: "chat-1", messageId: "media-1", caption: "first photo" }),
    });

    await inbox.enqueue({
      source: "telegram",
      thread_id: "chat-1",
      message_id: "media-2",
      key,
      lane: "main",
      received_at_ms: 2_000,
      payload: makeLegacyMediaPlaceholderMessage({ threadId: "chat-1", messageId: "media-2", caption: "second photo" }),
    });

    const rows = await db.all<{ message_id: string; status: string; payload_json: string }>(
      "SELECT message_id, status, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );
    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();
    expect(synthetic?.status).toBe("queued");

    const payload = JSON.parse(synthetic!.payload_json) as { message?: { content?: { text?: string } } };
    expect(payload.message?.content?.text ?? "").toContain("attachments=1");
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

  it("summarize_dropped derives delivery identity from the dropped rows", async () => {
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_CAP"] = "2";
    process.env["TYRUM_CHANNEL_INBOUND_QUEUE_OVERFLOW"] = "summarize_dropped";

    const key = "agent:default:telegram:work:dm:chat-1";

    await inbox.enqueue({
      source: "telegram:work",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      lane: "main",
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-1", text: "one", accountId: "work" }),
    });

    await inbox.enqueue({
      source: "telegram:work",
      thread_id: "chat-1",
      message_id: "msg-2",
      key,
      lane: "main",
      received_at_ms: 2_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-2", text: "two", accountId: "work" }),
    });

    await inbox.enqueue({
      source: "telegram:work",
      thread_id: "chat-1",
      message_id: "msg-3",
      key,
      lane: "main",
      received_at_ms: 3_000,
      payload: makeNormalizedTextMessage({ threadId: "chat-1", messageId: "msg-3", text: "three", accountId: "work" }),
    });

    const rows = await db.all<{ message_id: string; payload_json: string }>(
      "SELECT message_id, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );
    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();

    const payload = JSON.parse(synthetic!.payload_json) as { message?: { envelope?: { delivery?: { channel?: string; account?: string } } } };
    expect(payload.message?.envelope?.delivery?.channel).toBe("telegram");
    expect(payload.message?.envelope?.delivery?.account).toBe("work");
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
