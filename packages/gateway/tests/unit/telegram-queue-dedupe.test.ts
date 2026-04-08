import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { TelegramChannelQueue, telegramThreadKey } from "../../src/modules/channels/telegram.js";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";

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

describe("TelegramChannelQueue.enqueue dedupe behavior", () => {
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

  it("does not re-trigger interrupt side effects when the delivery is deduped", async () => {
    const agentId = "agent-1";
    const accountId = "acc-1";

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

    await db.run(
      `INSERT INTO conversation_leases (tenant_id, conversation_key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, "worker-1", 60_000],
    );

    let nowMs = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    try {
      const conversationDal = new ConversationDal(
        db,
        new IdentityScopeDal(db),
        new ChannelThreadDal(db),
      );
      const queue = new TelegramChannelQueue(db, {
        conversationDal,
        agentId,
        accountId,
        dmScope: "per_account_channel_peer",
      });

      const first = await queue.enqueue(normalized, { queueMode: "interrupt" });
      expect(first.deduped).toBe(false);

      const firstSignal = await db.get<{ created_at_ms: number }>(
        "SELECT created_at_ms FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
        [DEFAULT_TENANT_ID, key],
      );
      expect(firstSignal?.created_at_ms).toBe(1_000);

      nowMs = 2_000;
      const second = await queue.enqueue(normalized, { queueMode: "interrupt" });
      expect(second.deduped).toBe(true);

      const secondSignal = await db.get<{ created_at_ms: number }>(
        "SELECT created_at_ms FROM conversation_queue_signals WHERE tenant_id = ? AND conversation_key = ?",
        [DEFAULT_TENANT_ID, key],
      );
      expect(secondSignal?.created_at_ms).toBe(1_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("emits queue diagnostics when telegram debug logging is enabled", async () => {
    const logger = { info: vi.fn() };
    const conversationDal = new ConversationDal(
      db,
      new IdentityScopeDal(db),
      new ChannelThreadDal(db),
    );
    const queue = new TelegramChannelQueue(db, {
      conversationDal,
      agentId: "agent-1",
      accountId: "acc-1",
      dmScope: "per_account_channel_peer",
      logger: logger as never,
    });

    const normalized = makeNormalizedTextMessage({
      threadId: "chat-1",
      messageId: "msg-1",
      text: "hello",
    });

    const result = await queue.enqueue(normalized, { debugLoggingEnabled: true });

    expect(result.deduped).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.queue",
      expect.objectContaining({
        debug_scope: "channel",
        account_key: "acc-1",
        agent_id: "agent-1",
        thread_id: "chat-1",
        message_id: "msg-1",
        queue_mode: "collect",
        status: "queued",
        deduped: false,
        text_length: 5,
      }),
    );
  });
});
