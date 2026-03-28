import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";

describe("TelegramChannelProcessor approval-gated outbox robustness", () => {
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

  it("clears approved outbox items even when channel_inbox row is missing", async () => {
    const key = "agent:default:telegram:default:dm:chat-1";
    const approvalId = "00000000-0000-4000-8000-0000000000aa";

    const conversationDal = new ConversationDal(
      db,
      new IdentityScopeDal(db),
      new ChannelThreadDal(db),
    );
    const conversation = await conversationDal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "telegram",
      accountKey: "default",
      providerThreadId: "chat-1",
      containerKind: "dm",
    });

    await db.run(
      `INSERT INTO channel_inbox (
         tenant_id,
         source,
         thread_id,
         message_id,
         key,
         received_at_ms,
         payload_json,
         status,
         workspace_id,
         conversation_id,
         channel_thread_id
      ) VALUES (?, ?, ?, ?, ?, ?, '{}', 'completed', ?, ?, ?)`,
      [
        conversation.tenant_id,
        "telegram:default",
        "chat-1",
        "msg-1",
        key,
        1_000,
        conversation.workspace_id,
        conversation.conversation_id,
        conversation.channel_thread_id,
      ],
    );

    const inboxRow = await db.get<{ inbox_id: number }>(
      "SELECT inbox_id FROM channel_inbox WHERE tenant_id = ? AND message_id = ?",
      [conversation.tenant_id, "msg-1"],
    );
    expect(typeof inboxRow?.inbox_id).toBe("number");

    await db.run(
      `INSERT INTO approvals (
         tenant_id,
         approval_id,
         approval_key,
         agent_id,
         workspace_id,
         kind,
         status,
         prompt,
         motivation
       ) VALUES (?, ?, ?, ?, ?, 'connector.send', 'queued', ?, ?)`,
      [
        conversation.tenant_id,
        approvalId,
        `approval:${approvalId}`,
        conversation.agent_id,
        conversation.workspace_id,
        "Approve outbound Telegram send",
        "Approve outbound Telegram send",
      ],
    );

    await db.run(
      `INSERT INTO channel_outbox (
         tenant_id,
         inbox_id,
         source,
         thread_id,
         dedupe_key,
         text,
         status,
         approval_id,
         workspace_id,
         conversation_id,
         channel_thread_id
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        conversation.tenant_id,
        inboxRow!.inbox_id,
        "telegram:default",
        "chat-1",
        "dedupe-approval-1",
        "outbox text",
        approvalId,
        conversation.workspace_id,
        conversation.conversation_id,
        conversation.channel_thread_id,
      ],
    );

    // Simulate a legacy/corrupt database where the outbox no longer has a matching inbox row.
    // (For example: missing FK constraints + pruning of inbox rows.)
    await db.exec("PRAGMA foreign_keys = OFF");
    await db.run("DELETE FROM channel_inbox WHERE inbox_id = ?", [inboxRow!.inbox_id]);

    const approvalDal = {
      expireStale: vi.fn(async () => 0),
      getById: vi.fn(async ({ approvalId: id }: { approvalId: string }) => ({
        approval_id: id,
        status: "approved",
      })),
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
