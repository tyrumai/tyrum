import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import type { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import type { ApprovalDal } from "../../src/modules/approval/dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";

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

describe("TelegramChannelProcessor send policy overrides", () => {
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

  it("suppresses outbox enqueue when send_policy is off", async () => {
    const inbox = new ChannelInboxDal(db);

    const key = "agent:default:telegram:default:dm:chat-1";

    await db.run(
      `INSERT INTO conversation_send_policy_overrides (
         tenant_id,
         conversation_key,
         send_policy,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, "off", 1_000],
    );

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
      }),
    });

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => ({
          reply: "agent reply",
          conversation_id: "conversation-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 0,
      maxBatch: 1,
    });

    await processor.tick();

    const outboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_outbox",
    );
    expect(outboxCount?.count).toBe(0);

    const inboxCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM channel_inbox WHERE message_id = ?",
      ["msg-1"],
    );
    expect(inboxCount?.count).toBe(0);
    expect((telegramBot.sendMessage as any).mock.calls.length).toBe(0);
  });

  it("bypasses approval gating when send_policy is on", async () => {
    const inbox = new ChannelInboxDal(db);

    const key = "agent:default:telegram:default:dm:chat-1";

    await db.run(
      `INSERT INTO conversation_send_policy_overrides (
         tenant_id,
         conversation_key,
         send_policy,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, "on", 1_000],
    );

    await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
      }),
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction: vi.fn(async () => ({
        decision: "require_approval",
        policy_snapshot: { policy_snapshot_id: "snap-1" },
      })),
    } as unknown as PolicyService;

    const approvalDal = {
      create: vi.fn(async () => ({ id: 123 })),
      expireStale: vi.fn(async () => {}),
      getById: vi.fn(async () => undefined),
    } as unknown as ApprovalDal;

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => ({
          reply: "agent reply",
          conversation_id: "conversation-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
      getPolicyService: vi.fn(() => policyService),
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

    expect((approvalDal.create as any).mock.calls.length).toBe(0);

    const outbox = await db.get<{ approval_id: number | null }>(
      "SELECT approval_id FROM channel_outbox LIMIT 1",
    );
    expect(outbox?.approval_id ?? null).toBeNull();
    expect((telegramBot.sendMessage as any).mock.calls.length).toBeGreaterThan(0);
  });

  it("blocks already queued outbox sends when send_policy is off", async () => {
    const key = "agent:default:telegram:default:dm:chat-1";

    await db.run(
      `INSERT INTO conversation_send_policy_overrides (
         tenant_id,
         conversation_key,
         send_policy,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, key, "off", 1_000],
    );

    const inbox = new ChannelInboxDal(db);
    const outboxDal = new ChannelOutboxDal(db);

    const { row: inboxRow } = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "chat-1",
      message_id: "msg-1",
      key,
      received_at_ms: 1_000,
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
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
      [inboxRow.inbox_id],
    );

    await outboxDal.enqueue({
      tenant_id: inboxRow.tenant_id,
      inbox_id: inboxRow.inbox_id,
      source: "telegram:default",
      thread_id: "chat-1",
      dedupe_key: "dedupe-1",
      chunk_index: 0,
      text: "outbox text",
      workspace_id: inboxRow.workspace_id,
      conversation_id: inboxRow.conversation_id,
      channel_thread_id: inboxRow.channel_thread_id,
    });

    const agents: AgentRegistry = {
      getRuntime: vi.fn(async () => ({
        turn: vi.fn(async () => ({
          reply: "agent reply",
          conversation_id: "conversation-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
    } as unknown as AgentRegistry;

    const telegramBot: TelegramBot = {
      sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    } as unknown as TelegramBot;

    const processor = new TelegramChannelProcessor({
      db,
      agents,
      telegramBot,
      owner: "worker-1",
      debounceMs: 0,
      maxBatch: 1,
    });

    await processor.tick();

    expect((telegramBot.sendMessage as any).mock.calls.length).toBe(0);
    const outboxRow = await db.get<{ status: string }>(
      "SELECT status FROM channel_outbox WHERE dedupe_key = ?",
      ["dedupe-1"],
    );
    expect(outboxRow?.status).toBe("failed");
  });
});
