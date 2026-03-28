import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import { ConversationQueueInterruptError } from "../../src/modules/conversation-queue/queue-signal-dal.js";

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

describe("TelegramChannelProcessor interrupt handling", () => {
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

  it("does not send an error message or mark rows failed when a run is intentionally interrupted", async () => {
    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => {
          throw new ConversationQueueInterruptError("interrupted");
        }),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    const { row } = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:default:dm:chat-1",
      received_at_ms: 1_000,
      queue_mode: "collect",
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
      }),
    });

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 0,
      maxBatch: 5,
    });

    await processor.tick();

    expect(telegramBot.sendMessage).not.toHaveBeenCalled();

    const updated = await inbox.getById(row.inbox_id);
    expect(updated).toBeUndefined();
  });
});
