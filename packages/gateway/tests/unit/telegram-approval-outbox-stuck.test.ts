import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { ApprovalDal } from "../../src/modules/approval/dal.js";

describe("TelegramChannelProcessor approval-gated outbox robustness", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("clears approved outbox items even when channel_inbox row is missing", async () => {
    const key = "agent:default:telegram:default:dm:chat-1";
    const lane = "main";

    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'completed')`,
      ["telegram", "chat-1", "msg-1", key, lane, 1_000],
    );

    const inboxRow = await db.get<{ inbox_id: number }>(
      "SELECT inbox_id FROM channel_inbox WHERE message_id = ?",
      ["msg-1"],
    );
    expect(typeof inboxRow?.inbox_id).toBe("number");

    await db.run(
      `INSERT INTO channel_outbox (
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         text,
         status,
         approval_id
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
      [inboxRow!.inbox_id, "telegram", "chat-1", "dedupe-approval-1", "outbox text", 123],
    );

    // Simulate a legacy/corrupt database where the outbox no longer has a matching inbox row.
    // (For example: missing FK constraints + pruning of inbox rows.)
    await db.exec("PRAGMA foreign_keys = OFF");
    await db.run("DELETE FROM channel_inbox WHERE inbox_id = ?", [inboxRow!.inbox_id]);

    const approvalDal = {
      expireStale: vi.fn(async () => {}),
      getById: vi.fn(async (id: number) => ({ id, status: "approved" })),
    } as unknown as ApprovalDal;

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => {
        throw new Error("unexpected runtime call");
      }),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      approvalDal,
      debounceMs: 0,
      maxBatch: 1,
    });

    await processor.tick();

    const outbox = await db.get<{ approval_id: number | null; status: string }>(
      "SELECT approval_id, status FROM channel_outbox WHERE dedupe_key = ?",
      ["dedupe-approval-1"],
    );
    expect(outbox?.approval_id ?? null).toBeNull();
    expect(outbox?.status).not.toBe("queued");
  });
});
