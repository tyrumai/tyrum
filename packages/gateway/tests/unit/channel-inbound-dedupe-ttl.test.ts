import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("Channel inbound dedupe TTL", () => {
  let db: SqliteDb;
  let inbox: ChannelInboxDal;
  const originalTtlMs = process.env["TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS"];

  beforeEach(() => {
    process.env["TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS"] = "10";
    db = openTestSqliteDb();
    inbox = new ChannelInboxDal(db);
  });

  afterEach(async () => {
    await db.close();
    if (originalTtlMs === undefined) {
      delete process.env["TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS"];
    } else {
      process.env["TYRUM_CHANNEL_INBOUND_DEDUPE_TTL_MS"] = originalTtlMs;
    }
  });

  it("allows re-enqueue after TTL expiry", async () => {
    const first = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      payload: { message: "first" },
    });

    const second = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_011,
      payload: { message: "second" },
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
    expect(second.row.inbox_id).not.toBe(first.row.inbox_id);
  });

  it("rejects connector-only channel sources", async () => {
    await expect(
      inbox.enqueue({
        source: "telegram",
        thread_id: "chat-1",
        message_id: "msg-1",
        key: "agent:default:telegram:default:dm:chat-1",
        lane: "main",
        received_at_ms: 1_000,
        payload: { message: "first" },
      }),
    ).rejects.toThrow('channel source must be in "connector:account" form');
  });

  it("dedupes concurrent enqueues for the same delivery key", async () => {
    const input = {
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      lane: "main",
      received_at_ms: 1_000,
      payload: { message: "hello" },
    };

    const [a, b] = await Promise.all([inbox.enqueue(input), inbox.enqueue(input)]);

    expect(a.row.inbox_id).toBe(b.row.inbox_id);
    expect(a.deduped || b.deduped).toBe(true);

    const rows = await db.all<{ inbox_id: number }>(
      `SELECT inbox_id
       FROM channel_inbox
       WHERE source = ? AND thread_id = ? AND message_id = ?`,
      [input.source, input.thread_id, input.message_id],
    );
    expect(rows).toHaveLength(1);
  });
});
