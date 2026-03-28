import type { NormalizedThreadMessage } from "@tyrum/contracts";
import type { ConversationRow } from "../../src/modules/agent/conversation-dal.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";

function containerKindFromThreadKind(
  threadKind: "private" | "group" | "supergroup" | "channel" | "other",
): "dm" | "group" | "channel" {
  if (threadKind === "private") return "dm";
  if (threadKind === "channel") return "channel";
  return "group";
}

export function createTelegramNormalizedMessage(input: {
  threadId: string;
  messageId: string;
  text: string;
  receivedAt: string;
  threadKind?: "private" | "group" | "supergroup" | "channel" | "other";
}): NormalizedThreadMessage {
  const threadKind = input.threadKind ?? "channel";
  return {
    thread: {
      id: input.threadId,
      kind: threadKind,
      pii_fields: [],
    },
    message: {
      id: input.messageId,
      thread_id: input.threadId,
      source: "telegram",
      content: { text: input.text, attachments: [] },
      timestamp: input.receivedAt,
      pii_fields: ["message_text"],
      envelope: {
        message_id: input.messageId,
        received_at: input.receivedAt,
        delivery: { channel: "telegram", account: "default" },
        container: { kind: containerKindFromThreadKind(threadKind), id: input.threadId },
        sender: { id: "user-1", display: "User 1" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

export async function seedCompletedTelegramTurn(input: {
  inboxDal: ChannelInboxDal;
  outboxDal: ChannelOutboxDal;
  conversation: ConversationRow;
  threadId: string;
  messageId: string;
  userText: string;
  assistantText: string;
  receivedAtMs: number;
  threadKind?: "private" | "group" | "supergroup" | "channel" | "other";
  owner?: string;
}): Promise<void> {
  const owner = input.owner ?? "worker-1";
  const receivedAt = new Date(input.receivedAtMs).toISOString();
  const { row } = await input.inboxDal.enqueue({
    source: "telegram:default",
    thread_id: input.threadId,
    message_id: input.messageId,
    key: input.conversation.conversation_key,
    received_at_ms: input.receivedAtMs,
    payload: createTelegramNormalizedMessage({
      threadId: input.threadId,
      messageId: input.messageId,
      text: input.userText,
      receivedAt,
      threadKind: input.threadKind,
    }),
  });

  const claimed = await input.inboxDal.claimNext({
    owner,
    now_ms: input.receivedAtMs + 1,
    lease_ttl_ms: 60_000,
  });
  if (!claimed || claimed.inbox_id !== row.inbox_id) {
    throw new Error("failed to claim seeded channel inbox row");
  }

  await input.outboxDal.enqueue({
    tenant_id: row.tenant_id,
    inbox_id: row.inbox_id,
    source: row.source,
    thread_id: row.thread_id,
    dedupe_key: `repair:${String(row.inbox_id)}:0`,
    chunk_index: 0,
    text: input.assistantText,
    workspace_id: row.workspace_id,
    conversation_id: row.conversation_id,
    channel_thread_id: row.channel_thread_id,
  });

  const marked = await input.inboxDal.markCompleted(row.inbox_id, owner, input.assistantText);
  if (!marked) {
    throw new Error("failed to mark seeded channel inbox row as completed");
  }
}
