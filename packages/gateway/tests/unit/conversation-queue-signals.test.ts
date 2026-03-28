import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ConversationQueueSignalDal } from "../../src/modules/conversation-queue/queue-signal-dal.js";

describe("ConversationQueueSignalDal", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let inbox: ChannelInboxDal;
  let signals: ConversationQueueSignalDal;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    inbox = new ChannelInboxDal(db);
    signals = new ConversationQueueSignalDal(db);
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("claims steer and completes steer-only inbox rows", async () => {
    const { row } = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-steer",
      key: "agent:default:telegram:default:dm:chat-1",
      received_at_ms: 1_000,
      queue_mode: "steer",
      payload: { ok: true },
    });

    await signals.setSignal({
      tenant_id: row.tenant_id,
      key: row.key,
      kind: "steer",
      inbox_id: row.inbox_id,
      queue_mode: "steer",
      message_text: "steer me",
      created_at_ms: 1_000,
    });

    const claimed = await signals.claimSignal({
      tenant_id: row.tenant_id,
      key: row.key,
    });
    expect(claimed?.kind).toBe("steer");

    const updated = await inbox.getById(row.inbox_id);
    // Queue-only semantics: steer-only rows are removed once processed.
    expect(updated).toBeUndefined();
  });

  it("completes steer-only inbox rows even if they are processing", async () => {
    const { row } = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-steer-processing",
      key: "agent:default:telegram:default:dm:chat-1",
      received_at_ms: 1_000,
      queue_mode: "steer",
      payload: { ok: true },
    });

    const claimed = await inbox.claimNext({
      owner: "worker-2",
      now_ms: 1_100,
      lease_ttl_ms: 60_000,
    });
    expect(claimed?.inbox_id).toBe(row.inbox_id);
    expect(claimed?.status).toBe("processing");

    await signals.setSignal({
      tenant_id: row.tenant_id,
      key: row.key,
      kind: "steer",
      inbox_id: row.inbox_id,
      queue_mode: "steer",
      message_text: "steer me",
      created_at_ms: 1_100,
    });

    const steerSignal = await signals.claimSignal({
      tenant_id: row.tenant_id,
      key: row.key,
    });
    expect(steerSignal?.kind).toBe("steer");

    const updated = await inbox.getById(row.inbox_id);
    // Queue-only semantics: steer-only rows are removed once processed.
    expect(updated).toBeUndefined();
  });

  it("claims steer but preserves steer_backlog inbox rows", async () => {
    const { row } = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-steer-backlog",
      key: "agent:default:telegram:default:dm:chat-1",
      received_at_ms: 1_000,
      queue_mode: "steer_backlog",
      payload: { ok: true },
    });

    await signals.setSignal({
      tenant_id: row.tenant_id,
      key: row.key,
      kind: "steer",
      inbox_id: row.inbox_id,
      queue_mode: "steer_backlog",
      message_text: "steer me",
      created_at_ms: 1_000,
    });

    const claimed = await signals.claimSignal({
      tenant_id: row.tenant_id,
      key: row.key,
    });
    expect(claimed?.kind).toBe("steer");

    const updated = await inbox.getById(row.inbox_id);
    expect(updated?.status).toBe("queued");
  });
});
