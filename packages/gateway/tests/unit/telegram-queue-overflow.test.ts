import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { RunResult, SqlDb } from "../../src/statestore/types.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelQueue } from "../../src/modules/channels/telegram.js";
import { WsEventEnvelope, WsEvent } from "@tyrum/contracts";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

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
      content: { text: input.text, attachments: [] },
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

function makeAttachmentOnlyMessage(input: {
  threadId: string;
  messageId: string;
  caption?: string;
}): NormalizedThreadMessage {
  const nowIso = new Date().toISOString();
  const attachment = {
    artifact_id: "11111111-1111-4111-8111-111111111111",
    uri: "artifact://11111111-1111-4111-8111-111111111111",
    external_url: "https://gateway.example/a/11111111-1111-4111-8111-111111111111",
    kind: "file" as const,
    media_class: "image" as const,
    created_at: nowIso,
    filename: "photo.jpg",
    mime_type: "image/jpeg",
    size_bytes: 4,
    sha256: "a".repeat(64),
    labels: [],
    channel_kind: "photo",
  };
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
      content: {
        text: input.caption,
        attachments: [attachment],
      },
      timestamp: nowIso,
      pii_fields: input.caption ? ["message_text"] : [],
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
          !this.injected &&
          result.changes === 1 &&
          sql.includes("UPDATE channel_inbox") &&
          sql.includes("SET status = 'completed'")
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
  const defaultThreadId = "chat-1";
  const defaultLane = "main";
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

  const queueKey = (accountId = "default", threadId = defaultThreadId) =>
    `agent:default:telegram:${accountId}:dm:${threadId}`;

  async function enqueueTextMessage(input: {
    messageId: string;
    text: string;
    receivedAtMs: number;
    threadId?: string;
    accountId?: string;
    source?: string;
    key?: string;
    lane?: string;
  }): Promise<void> {
    const threadId = input.threadId ?? defaultThreadId;
    const accountId = input.accountId ?? "default";
    await inbox.enqueue({
      source: input.source ?? `telegram:${accountId}`,
      thread_id: threadId,
      message_id: input.messageId,
      key: input.key ?? queueKey(accountId, threadId),
      lane: input.lane ?? defaultLane,
      received_at_ms: input.receivedAtMs,
      payload: makeNormalizedTextMessage({
        threadId,
        messageId: input.messageId,
        text: input.text,
        accountId,
      }),
    });
  }

  async function enqueueAttachmentMessage(input: {
    messageId: string;
    receivedAtMs: number;
    caption?: string;
    threadId?: string;
    source?: string;
    key?: string;
    lane?: string;
  }): Promise<void> {
    const threadId = input.threadId ?? defaultThreadId;
    await inbox.enqueue({
      source: input.source ?? "telegram:default",
      thread_id: threadId,
      message_id: input.messageId,
      key: input.key ?? queueKey(),
      lane: input.lane ?? defaultLane,
      received_at_ms: input.receivedAtMs,
      payload: makeAttachmentOnlyMessage({
        threadId,
        messageId: input.messageId,
        caption: input.caption,
      }),
    });
  }

  function createTelegramQueue(lane = defaultLane) {
    const send = vi.fn();
    const queue = new TelegramChannelQueue(db, {
      agentId: "default",
      accountId: "default",
      lane,
      dmScope: "per_account_channel_peer",
      inboxConfig: {
        inboundQueueCap: 1,
        inboundQueueOverflowPolicy: "drop_newest",
      },
      ws: {
        connectionManager: {
          allClients: () => [
            { role: "client", auth_claims: { tenant_id: DEFAULT_TENANT_ID }, ws: { send } },
          ],
        },
      },
    });
    return { queue, send };
  }

  async function enqueueFollowup(
    queue: TelegramChannelQueue,
    messageId: string,
    text: string,
  ): Promise<void> {
    await queue.enqueue(makeNormalizedTextMessage({ threadId: defaultThreadId, messageId, text }), {
      queueMode: "followup",
    });
  }

  it("drop_oldest drops the oldest queued rows when cap is exceeded", async () => {
    inbox = new ChannelInboxDal(db, undefined, {
      inboundQueueCap: 2,
      inboundQueueOverflowPolicy: "drop_oldest",
    });

    const key = queueKey();
    await enqueueTextMessage({ messageId: "msg-1", text: "one", receivedAtMs: 1_000, key });
    await enqueueTextMessage({ messageId: "msg-2", text: "two", receivedAtMs: 2_000, key });
    await enqueueTextMessage({ messageId: "msg-3", text: "three", receivedAtMs: 3_000, key });

    const rows = await db.all<{ message_id: string; status: string }>(
      "SELECT message_id, status FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    expect(rows.map((r) => [r.message_id, r.status])).toEqual([
      ["msg-2", "queued"],
      ["msg-3", "queued"],
    ]);
  });

  it("drop_newest drops the newest queued rows when cap is exceeded", async () => {
    inbox = new ChannelInboxDal(db, undefined, {
      inboundQueueCap: 2,
      inboundQueueOverflowPolicy: "drop_newest",
    });

    const key = queueKey();
    await enqueueTextMessage({ messageId: "msg-1", text: "one", receivedAtMs: 1_000, key });
    await enqueueTextMessage({ messageId: "msg-2", text: "two", receivedAtMs: 2_000, key });
    await enqueueTextMessage({ messageId: "msg-3", text: "three", receivedAtMs: 3_000, key });

    const rows = await db.all<{ message_id: string; status: string }>(
      "SELECT message_id, status FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    expect(rows.map((r) => [r.message_id, r.status])).toEqual([
      ["msg-1", "queued"],
      ["msg-2", "queued"],
    ]);
  });

  it("enforces cap when the queue grows during trimming (simulated concurrency)", async () => {
    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = defaultLane;

    const injectingDb = new InjectingOverflowDb(db, {
      key,
      lane,
      source: "telegram:default",
      threadId: "chat-1",
      messageId: "msg-injected",
      receivedAtMs: 1_500,
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-injected",
        text: "injected",
      }),
    });

    inbox = new ChannelInboxDal(injectingDb, undefined, {
      inboundQueueCap: 1,
      inboundQueueOverflowPolicy: "drop_oldest",
    });

    await enqueueTextMessage({ messageId: "msg-1", text: "one", receivedAtMs: 1_000, key, lane });
    await enqueueTextMessage({ messageId: "msg-2", text: "two", receivedAtMs: 2_000, key, lane });

    const queued = await db.all<{ message_id: string }>(
      `SELECT message_id
       FROM channel_inbox
       WHERE status = 'queued' AND key = ? AND lane = ?
       ORDER BY received_at_ms ASC, inbox_id ASC`,
      [key, lane],
    );

    expect(queued.map((row) => row.message_id)).toEqual(["msg-2"]);
  });

  it("summarize_dropped includes attachment counts for attachment-only messages without envelopes", async () => {
    inbox = new ChannelInboxDal(db, undefined, {
      inboundQueueCap: 1,
      inboundQueueOverflowPolicy: "summarize_dropped",
    });

    const key = queueKey();
    await enqueueAttachmentMessage({
      messageId: "media-1",
      caption: "first photo",
      receivedAtMs: 1_000,
      key,
    });
    await enqueueAttachmentMessage({
      messageId: "media-2",
      caption: "second photo",
      receivedAtMs: 2_000,
      key,
    });

    const rows = await db.all<{ message_id: string; status: string; payload_json: string }>(
      "SELECT message_id, status, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );
    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();
    expect(synthetic?.status).toBe("queued");

    const payload = JSON.parse(synthetic!.payload_json) as {
      message?: { content?: { text?: string } };
    };
    expect(payload.message?.content?.text ?? "").toContain("attachments=1");
  });

  it("summarize_dropped replaces overflow with a synthetic follow-up message", async () => {
    inbox = new ChannelInboxDal(db, undefined, {
      inboundQueueCap: 2,
      inboundQueueOverflowPolicy: "summarize_dropped",
    });

    const key = queueKey();
    await enqueueTextMessage({ messageId: "msg-1", text: "one", receivedAtMs: 1_000, key });
    await enqueueTextMessage({ messageId: "msg-2", text: "two", receivedAtMs: 2_000, key });
    await enqueueTextMessage({ messageId: "msg-3", text: "three", receivedAtMs: 3_000, key });

    const rows = await db.all<{ message_id: string; status: string; payload_json: string }>(
      "SELECT message_id, status, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );

    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();
    expect(synthetic?.status).toBe("queued");

    const payload = JSON.parse(synthetic!.payload_json) as {
      message?: { content?: { text?: string } };
    };
    expect(payload.message?.content?.text ?? "").toContain("Queue overflow");
    expect(payload.message?.content?.text ?? "").toContain("one");

    const rowStates = rows.map((r) => [
      r.message_id.startsWith("queue_overflow:") ? "synthetic" : r.message_id,
      r.status,
    ]);
    expect(rowStates).toEqual([
      ["synthetic", "queued"],
      ["msg-3", "queued"],
    ]);
  });

  it("summarize_dropped derives delivery identity from the dropped rows", async () => {
    inbox = new ChannelInboxDal(db, undefined, {
      inboundQueueCap: 2,
      inboundQueueOverflowPolicy: "summarize_dropped",
    });

    const key = queueKey("work");
    await enqueueTextMessage({
      messageId: "msg-1",
      text: "one",
      receivedAtMs: 1_000,
      accountId: "work",
      key,
    });
    await enqueueTextMessage({
      messageId: "msg-2",
      text: "two",
      receivedAtMs: 2_000,
      accountId: "work",
      key,
    });
    await enqueueTextMessage({
      messageId: "msg-3",
      text: "three",
      receivedAtMs: 3_000,
      accountId: "work",
      key,
    });

    const rows = await db.all<{ message_id: string; payload_json: string }>(
      "SELECT message_id, payload_json FROM channel_inbox ORDER BY received_at_ms ASC, inbox_id ASC",
    );
    const synthetic = rows.find((row) => row.message_id.startsWith("queue_overflow:"));
    expect(synthetic).toBeTruthy();

    const payload = JSON.parse(synthetic!.payload_json) as {
      message?: { envelope?: { delivery?: { channel?: string; account?: string } } };
    };
    expect(payload.message?.envelope?.delivery?.channel).toBe("telegram");
    expect(payload.message?.envelope?.delivery?.account).toBe("work");
  });

  it("emits a WS event when overflow occurs (telegram queue)", async () => {
    const { queue, send } = createTelegramQueue();
    await enqueueFollowup(queue, "msg-1", "one");
    await enqueueFollowup(queue, "msg-2", "two");

    expect(send).toHaveBeenCalledTimes(1);
    const raw = send.mock.calls[0]?.[0];
    const parsed = WsEventEnvelope.safeParse(JSON.parse(String(raw)));
    expect(parsed.success).toBe(true);
    expect(parsed.data.type).toBe("channel.queue.overflow");
    const typed = WsEvent.safeParse(parsed.data);
    expect(typed.success).toBe(true);
  });

  it("normalizes invalid lane values so overflow events are not dropped", async () => {
    const { queue, send } = createTelegramQueue("not-a-real-lane");
    await enqueueFollowup(queue, "msg-1", "one");
    await enqueueFollowup(queue, "msg-2", "two");

    expect(send).toHaveBeenCalledTimes(1);
    const raw = send.mock.calls[0]?.[0];
    const parsed = WsEventEnvelope.safeParse(JSON.parse(String(raw)));
    expect(parsed.success).toBe(true);
    expect(parsed.data.type).toBe("channel.queue.overflow");
    expect((parsed.data.payload as { conversation_key?: string }).conversation_key).toBe(
      queueKey(),
    );
  });
});
