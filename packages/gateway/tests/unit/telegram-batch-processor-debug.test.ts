import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { processTelegramBatch } from "../../src/modules/channels/telegram-batch-processor.js";
import type { ChannelEgressConnector } from "../../src/modules/channels/interface.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { ConversationQueueInterruptError } from "../../src/modules/conversation-queue/queue-signal-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

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
        delivery: { channel: "telegram", account: "work" },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

async function claimInboxRow(input: {
  db: SqliteDb;
  threadId: string;
  messageId: string;
  text: string;
}) {
  const conversationDal = new ConversationDal(
    input.db,
    new IdentityScopeDal(input.db),
    new ChannelThreadDal(input.db),
  );
  const inbox = new ChannelInboxDal(input.db, conversationDal);
  const outbox = new ChannelOutboxDal(input.db);

  await inbox.enqueue({
    source: "telegram:work",
    thread_id: input.threadId,
    message_id: input.messageId,
    key: `agent:default:telegram:work:dm:${input.threadId}`,
    received_at_ms: Date.now(),
    payload: makeNormalizedTextMessage({
      threadId: input.threadId,
      messageId: input.messageId,
      text: input.text,
    }),
  });

  const claimed = await inbox.claimNext({
    owner: "worker-1",
    now_ms: Date.now(),
    lease_ttl_ms: 60_000,
  });
  if (!claimed) {
    throw new Error("expected a claimed inbox row");
  }

  return { inbox, outbox, claimed };
}

function createDebugConnector(): ChannelEgressConnector {
  return {
    connector: "telegram",
    accountId: "work",
    debugLoggingEnabled: true,
    sendMessage: vi.fn(async () => ({ ok: true })),
  };
}

describe("processTelegramBatch debug diagnostics", () => {
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

  it("emits queued turn_started and turn_completed diagnostics", async () => {
    const { inbox, outbox, claimed } = await claimInboxRow({
      db,
      threadId: "chat-1",
      messageId: "msg-1",
      text: "hello",
    });
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const connector = createDebugConnector();
    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => ({
          reply: "Queued reply",
          attachments: [],
        })),
      })),
    } as never;

    await processTelegramBatch(
      {
        db,
        inbox,
        outbox,
        agents,
        egressConnectors: new Map([["telegram:work", connector]]),
        owner: "worker-1",
        logger: logger as never,
        typingMode: "never",
        typingRefreshMs: 0,
        typingAutomationEnabled: false,
      },
      [claimed],
    );

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.turn_started",
      expect.objectContaining({
        account_key: "work",
        mode: "queued",
        agent_id: "default",
        thread_id: "chat-1",
        inbox_id: claimed.inbox_id,
        conversation_key: claimed.key,
        message_count: 1,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.turn_completed",
      expect.objectContaining({
        account_key: "work",
        mode: "queued",
        agent_id: "default",
        thread_id: "chat-1",
        inbox_id: claimed.inbox_id,
        conversation_key: claimed.key,
        reply_length: "Queued reply".length,
        attachment_count: 0,
      }),
    );
  });

  it("emits queued turn_failed diagnostics", async () => {
    const { inbox, outbox, claimed } = await claimInboxRow({
      db,
      threadId: "chat-2",
      messageId: "msg-2",
      text: "hello",
    });
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const connector = createDebugConnector();
    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => {
          throw new Error("queue runtime failed");
        }),
      })),
    } as never;

    await processTelegramBatch(
      {
        db,
        inbox,
        outbox,
        agents,
        egressConnectors: new Map([["telegram:work", connector]]),
        owner: "worker-1",
        logger: logger as never,
        typingMode: "never",
        typingRefreshMs: 0,
        typingAutomationEnabled: false,
      },
      [claimed],
    );

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.turn_failed",
      expect.objectContaining({
        account_key: "work",
        mode: "queued",
        agent_id: "default",
        thread_id: "chat-2",
        inbox_id: claimed.inbox_id,
        conversation_key: claimed.key,
        error: "queue runtime failed",
      }),
    );
  });

  it("emits queued turn_interrupted diagnostics", async () => {
    const { inbox, outbox, claimed } = await claimInboxRow({
      db,
      threadId: "chat-3",
      messageId: "msg-3",
      text: "hello",
    });
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const connector = createDebugConnector();
    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => {
          throw new ConversationQueueInterruptError("queue interrupted by operator");
        }),
      })),
    } as never;

    await processTelegramBatch(
      {
        db,
        inbox,
        outbox,
        agents,
        egressConnectors: new Map([["telegram:work", connector]]),
        owner: "worker-1",
        logger: logger as never,
        typingMode: "never",
        typingRefreshMs: 0,
        typingAutomationEnabled: false,
      },
      [claimed],
    );

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.turn_interrupted",
      expect.objectContaining({
        account_key: "work",
        mode: "queued",
        agent_id: "default",
        thread_id: "chat-3",
        inbox_id: claimed.inbox_id,
        conversation_key: claimed.key,
        error: "queue interrupted by operator",
      }),
    );
  });
});
