import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import {
  replaceTranscriptEventsTx,
  upsertConversationStateTx,
} from "../../src/modules/agent/conversation-dal-helpers.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { ConversationDalOptions } from "../../src/modules/agent/conversation-dal.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { seedCompletedTelegramTurn } from "../helpers/channel-conversation-repair.js";
import type { ConversationRow } from "../../src/modules/agent/conversation-dal.js";
import type { ConversationContextState, TyrumUIMessage } from "@tyrum/contracts";

export function textTranscript(conversation: { messages?: TyrumUIMessage[] | undefined }) {
  return (conversation.messages ?? [])
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [
              {
                id: message.id,
                role: message.role,
                content: part.text,
                created_at:
                  typeof message.metadata?.["timestamp"] === "string"
                    ? message.metadata["timestamp"]
                    : "",
              },
            ]
          : [],
      ),
    )
    .filter((item) => item.content.length > 0);
}

export function createConversationDalFixture(): { db: SqliteDb; dal: ConversationDal } {
  return createObservedConversationDalFixture();
}

export function createObservedConversationDalFixture(options?: ConversationDalOptions): {
  db: SqliteDb;
  dal: ConversationDal;
} {
  const db = openTestSqliteDb();
  const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
  const channelThreadDal = new ChannelThreadDal(db);
  return {
    db,
    dal: new ConversationDal(db, identityScopeDal, channelThreadDal, options),
  };
}

export async function appendTranscriptTurn(input: {
  dal: ConversationDal;
  tenantId: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  timestamp: string;
}) {
  return await input.dal.appendTurn({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    userMessage: input.userMessage,
    assistantMessage: input.assistantMessage,
    timestamp: input.timestamp,
  });
}

export async function appendThreeTranscriptTurns(input: {
  dal: ConversationDal;
  tenantId: string;
  conversationId: string;
}) {
  await appendTranscriptTurn({
    ...input,
    userMessage: "u1",
    assistantMessage: "a1",
    timestamp: "2026-02-17T00:00:00.000Z",
  });
  await appendTranscriptTurn({
    ...input,
    userMessage: "u2",
    assistantMessage: "a2",
    timestamp: "2026-02-17T00:01:00.000Z",
  });
  return await appendTranscriptTurn({
    ...input,
    userMessage: "u3",
    assistantMessage: "a3",
    timestamp: "2026-02-17T00:02:00.000Z",
  });
}

export async function seedRepairTurns(input: {
  db: SqliteDb;
  dal: ConversationDal;
  conversation: ConversationRow;
  threadId: string;
  turns: Array<{
    messageId: string;
    userText: string;
    assistantText: string;
    receivedAtMs: number;
  }>;
}) {
  const inboxDal = new ChannelInboxDal(input.db, input.dal);
  const outboxDal = new ChannelOutboxDal(input.db);
  for (const turn of input.turns) {
    await seedCompletedTelegramTurn({
      inboxDal,
      outboxDal,
      conversation: input.conversation,
      threadId: input.threadId,
      ...turn,
    });
  }
}

export async function setConversationTranscriptAndSummary(input: {
  db: SqliteDb;
  conversation: ConversationRow;
  transcriptJson: string;
  summary: string;
  updatedAt: string;
}) {
  const parsedMessages = (
    JSON.parse(input.transcriptJson) as Array<{
      role: "user" | "assistant" | "system";
      content: string;
      created_at?: string;
    }>
  ).map(
    (turn, index): TyrumUIMessage => ({
      id: `turn-${String(index)}`,
      role: turn.role,
      parts: [{ type: "text", text: turn.content }],
      metadata: turn.created_at ? { timestamp: turn.created_at } : undefined,
    }),
  );
  const contextState: ConversationContextState = {
    version: 1,
    recent_message_ids: parsedMessages.map((message) => message.id),
    checkpoint: input.summary
      ? {
          goal: "",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: [],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: input.summary,
        }
      : null,
    pending_approvals: [],
    pending_tool_state: [],
    updated_at: input.updatedAt,
  };
  await input.db.transaction(async (tx) => {
    await tx.run(
      `UPDATE conversations
       SET updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.updatedAt, input.conversation.tenant_id, input.conversation.conversation_id],
    );
    await replaceTranscriptEventsTx(tx, {
      tenantId: input.conversation.tenant_id,
      conversationId: input.conversation.conversation_id,
      messages: parsedMessages,
      fallbackCreatedAt: input.updatedAt,
    });
    await upsertConversationStateTx(tx, {
      tenantId: input.conversation.tenant_id,
      conversationId: input.conversation.conversation_id,
      contextState,
    });
  });
}

export async function setConversationUpdatedAt(input: {
  db: SqliteDb;
  tenantId: string;
  conversationIds: string[];
  valueSql: string;
}) {
  const placeholders = input.conversationIds.map(() => "?").join(", ");
  await input.db.run(
    `UPDATE conversations SET updated_at = ${input.valueSql} WHERE tenant_id = ? AND conversation_id IN (${placeholders})`,
    [input.tenantId, ...input.conversationIds],
  );
}
