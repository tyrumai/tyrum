import type { ConversationState, TyrumUIMessage } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { replaceTranscriptEventsTx, upsertConversationStateTx } from "./session-dal-storage.js";
import { createSessionContextStateForMessages } from "./session-dal-runtime.js";

export async function updateConversationTx(input: {
  db: SqlDb;
  tenantId: string;
  sessionId: string;
  title: string;
  updatedAt: string;
}): Promise<void> {
  await input.db.run(
    `UPDATE conversations
       SET title = ?, updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ?`,
    [input.title, input.updatedAt, input.tenantId, input.sessionId],
  );
}

export async function writeSessionMessagesTx(input: {
  db: SqlDb;
  tenantId: string;
  sessionId: string;
  messages: TyrumUIMessage[];
  title: string;
  contextState?: ConversationState;
  updatedAt?: string;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const contextState = input.contextState
    ? { ...input.contextState, updated_at: updatedAt }
    : createSessionContextStateForMessages(input.messages, updatedAt);
  await updateConversationTx({
    db: input.db,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    title: input.title,
    updatedAt,
  });
  await replaceTranscriptEventsTx(input.db, {
    tenantId: input.tenantId,
    conversationId: input.sessionId,
    messages: input.messages,
    fallbackCreatedAt: updatedAt,
  });
  await upsertConversationStateTx(input.db, {
    tenantId: input.tenantId,
    conversationId: input.sessionId,
    contextState,
  });
}

export async function writeContextStateTx(input: {
  db: SqlDb;
  tenantId: string;
  sessionId: string;
  title: string;
  contextState: ConversationState;
  updatedAt?: string;
}): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const contextState = { ...input.contextState, updated_at: updatedAt };
  await updateConversationTx({
    db: input.db,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    title: input.title,
    updatedAt,
  });
  await upsertConversationStateTx(input.db, {
    tenantId: input.tenantId,
    conversationId: input.sessionId,
    contextState,
  });
}
