import type { TyrumUIMessage } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { createTextChatMessage } from "../ai-sdk/message-utils.js";
import {
  createEmptySessionContextState,
  replaceTranscriptEventsTx,
  upsertConversationStateTx,
} from "./session-dal-helpers.js";

export function createTextMessage(input: {
  id?: string;
  role: TyrumUIMessage["role"];
  text: string;
}): TyrumUIMessage {
  return createTextChatMessage(input);
}

export async function deleteExpiredSessions(input: {
  agentId?: string;
  cutoffIso: string;
  db: SqlDb;
  tenantId: string;
}): Promise<number> {
  const agentClause = input.agentId ? "AND agent_id = ?" : "";
  const params = input.agentId
    ? [input.tenantId, input.agentId, input.cutoffIso]
    : [input.tenantId, input.cutoffIso];
  const sql =
    input.db.kind === "sqlite"
      ? `DELETE FROM conversations WHERE tenant_id = ? ${agentClause} AND datetime(replace(replace(updated_at, 'T', ' '), 'Z', '')) < datetime(replace(replace(?, 'T', ' '), 'Z', ''))`
      : `DELETE FROM conversations WHERE tenant_id = ? ${agentClause} AND updated_at < ?`;
  return (await input.db.run(sql, params)).changes;
}

export async function resetSessionContent(input: {
  db: SqlDb;
  sessionId: string;
  tenantId: string;
  updatedAt: string;
}): Promise<boolean> {
  let reset = false;
  const emptyContextState = createEmptySessionContextState(input.updatedAt);
  await input.db.transaction(async (tx) => {
    const res = await tx.run(
      "UPDATE conversations SET title = '', updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      [input.updatedAt, input.tenantId, input.sessionId],
    );
    if (res.changes !== 1) {
      return;
    }
    reset = true;
    await replaceTranscriptEventsTx(tx, {
      tenantId: input.tenantId,
      conversationId: input.sessionId,
      messages: [],
      fallbackCreatedAt: input.updatedAt,
    });
    await upsertConversationStateTx(tx, {
      tenantId: input.tenantId,
      conversationId: input.sessionId,
      contextState: emptyContextState,
    });
  });
  return reset;
}

export async function setSessionTitleIfBlank(input: {
  db: SqlDb;
  sessionId: string;
  tenantId: string;
  title: string;
  updatedAt: string;
}): Promise<boolean> {
  const result = await input.db.run(
    "UPDATE conversations SET title = ?, updated_at = ? WHERE tenant_id = ? AND conversation_id = ? AND trim(title) = ''",
    [input.title, input.updatedAt, input.tenantId, input.sessionId],
  );
  return result.changes === 1;
}
