import { randomUUID } from "node:crypto";
import { ChatMessage as ChatMessageSchema } from "@tyrum/schemas";
import type { ChatMessage } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export function createTextMessage(input: {
  id?: string;
  role: ChatMessage["role"];
  text: string;
}): ChatMessage {
  return ChatMessageSchema.parse({
    id: input.id ?? randomUUID(),
    role: input.role,
    parts: [{ type: "text", text: input.text }],
  });
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
      ? `DELETE FROM sessions WHERE tenant_id = ? ${agentClause} AND datetime(replace(replace(updated_at, 'T', ' '), 'Z', '')) < datetime(replace(replace(?, 'T', ' '), 'Z', ''))`
      : `DELETE FROM sessions WHERE tenant_id = ? ${agentClause} AND updated_at < ?`;
  return (await input.db.run(sql, params)).changes;
}

export async function resetSessionContent(input: {
  db: SqlDb;
  sessionId: string;
  tenantId: string;
  updatedAt: string;
}): Promise<boolean> {
  const emptyContextState = JSON.stringify({
    version: 1,
    recent_message_ids: [],
    checkpoint: null,
    pending_approvals: [],
    pending_tool_state: [],
    updated_at: input.updatedAt,
  });
  const res = await input.db.run(
    "UPDATE sessions SET messages_json = '[]', context_state_json = ?, title = '', updated_at = ? WHERE tenant_id = ? AND session_id = ?",
    [emptyContextState, input.updatedAt, input.tenantId, input.sessionId],
  );
  return res.changes === 1;
}

export async function setSessionTitleIfBlank(input: {
  db: SqlDb;
  sessionId: string;
  tenantId: string;
  title: string;
  updatedAt: string;
}): Promise<boolean> {
  const result = await input.db.run(
    "UPDATE sessions SET title = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ? AND trim(title) = ''",
    [input.title, input.updatedAt, input.tenantId, input.sessionId],
  );
  return result.changes === 1;
}
