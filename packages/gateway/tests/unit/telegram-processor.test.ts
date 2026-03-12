import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadMessage } from "@tyrum/schemas";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
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
        delivery: { channel: "telegram", account: "work" },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

describe("TelegramChannelProcessor", () => {
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

  it("loads dynamic egress connectors once per tenant within a tick", async () => {
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    const inbox = new ChannelInboxDal(db, sessionDal);
    const outbox = new ChannelOutboxDal(db);

    for (const messageId of ["msg-1", "msg-2"]) {
      const { row } = await inbox.enqueue({
        source: "telegram:work",
        thread_id: "chat-1",
        message_id: messageId,
        key: "agent:default:telegram:work:dm:chat-1",
        lane: "main",
        received_at_ms: Date.now(),
        payload: makeNormalizedTextMessage({
          threadId: "chat-1",
          messageId,
          text: `hello ${messageId}`,
        }),
      });

      await db.run(
        `UPDATE channel_inbox
         SET status = 'completed',
             lease_owner = NULL,
             lease_expires_at_ms = NULL,
             processed_at = datetime('now'),
             error = NULL,
             reply_text = ''
         WHERE inbox_id = ?`,
        [row.inbox_id],
      );

      await outbox.enqueue({
        tenant_id: row.tenant_id,
        inbox_id: row.inbox_id,
        source: "telegram:work",
        thread_id: "chat-1",
        dedupe_key: `dedupe-${messageId}`,
        chunk_index: 0,
        text: `reply ${messageId}`,
        workspace_id: row.workspace_id,
        session_id: row.session_id,
        channel_thread_id: row.channel_thread_id,
      });
    }

    const sendMessage = vi.fn(async () => ({ ok: true }));
    const listEgressConnectors = vi.fn(async () => [
      { connector: "telegram", accountId: "work", sendMessage },
    ]);
    const agents: AgentRegistry = { getRuntime: vi.fn() } as unknown as AgentRegistry;

    const processor = new TelegramChannelProcessor({
      db,
      sessionDal,
      agents,
      owner: "worker-1",
      listEgressConnectors,
      debounceMs: 0,
      maxBatch: 1,
    });

    await processor.tick();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(listEgressConnectors).toHaveBeenCalledTimes(1);
    expect(listEgressConnectors).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });
});
