import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { TelegramChannelQueue, telegramThreadKey } from "../../src/modules/channels/telegram.js";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";

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
        delivery: { channel: "telegram", account: "default" },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

describe("TelegramChannelQueue queue mode overrides", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("defaults queueMode from lane_queue_mode_overrides when unset", async () => {
    const agentId = "agent-1";
    const accountId = "acc-1";
    const lane = "main";

    const normalized = makeNormalizedTextMessage({
      threadId: "chat-1",
      messageId: "msg-1",
      text: "hello",
    });

    const key = telegramThreadKey(normalized, {
      agentId,
      accountId,
      dmScope: "per_account_channel_peer",
    });

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    try {
      const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));

      await db.run(
        `INSERT INTO lane_leases (tenant_id, key, lane, lease_owner, lease_expires_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, key, lane, "worker-1", 60_000],
      );

      await db.run(
        `INSERT INTO lane_queue_mode_overrides (tenant_id, key, lane, queue_mode, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [DEFAULT_TENANT_ID, key, lane, "interrupt", 1_000],
      );

      const queue = new TelegramChannelQueue(db, {
        sessionDal,
        agentId,
        accountId,
        lane,
        dmScope: "per_account_channel_peer",
      });

      const res = await queue.enqueue(normalized);
      expect(res.deduped).toBe(false);

      const inbox = await db.get<{ queue_mode: string }>(
        `SELECT queue_mode
         FROM channel_inbox
         WHERE tenant_id = ? AND key = ? AND lane = ? AND message_id = ?`,
        [DEFAULT_TENANT_ID, key, lane, "msg-1"],
      );
      expect(inbox?.queue_mode).toBe("interrupt");

      const signal = await db.get<{ kind: string; queue_mode: string }>(
        `SELECT kind, queue_mode
         FROM lane_queue_signals
         WHERE tenant_id = ? AND key = ? AND lane = ?`,
        [DEFAULT_TENANT_ID, key, lane],
      );
      expect(signal).toMatchObject({ kind: "interrupt", queue_mode: "interrupt" });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
