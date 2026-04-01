import type { ConversationState, TyrumUIMessage } from "@tyrum/contracts";
import type { SqlDb, StateStoreKind } from "../../statestore/types.js";

export const EMPTY_CONVERSATION_STATE = {
  version: 1,
  recent_message_ids: [],
  checkpoint: null,
  pending_approvals: [],
  pending_tool_state: [],
  updated_at: "1970-01-01T00:00:00.000Z",
} as const;

export const EMPTY_CONVERSATION_STATE_JSON = JSON.stringify(EMPTY_CONVERSATION_STATE);

export const CONVERSATION_MESSAGES_JSON_META = {
  table: "transcript_events",
  column: "messages_json",
  shape: "array",
} as const;

export const CONVERSATION_CONTEXT_STATE_JSON_META = {
  table: "conversation_state",
  column: "context_state_json",
  shape: "object",
} as const;

function buildConversationStateUpsertSql(kind: StateStoreKind): string {
  const summaryValue = kind === "postgres" ? "CAST(? AS JSONB)" : "?";
  const pendingValue = kind === "postgres" ? "CAST(? AS JSONB)" : "?";
  return `INSERT INTO conversation_state (
      tenant_id,
      conversation_id,
      summary_json,
      pending_json,
      updated_at
    )
    VALUES (?, ?, ${summaryValue}, ${pendingValue}, ?)
    ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
      summary_json = excluded.summary_json,
      pending_json = excluded.pending_json,
      updated_at = excluded.updated_at`;
}

function buildMessagesJsonSql(kind: StateStoreKind, alias: string): string {
  if (kind === "postgres") {
    return `COALESCE((
      SELECT jsonb_agg(message_json::jsonb ORDER BY event_index ASC)::text
      FROM transcript_events te
      WHERE te.tenant_id = ${alias}.tenant_id
        AND te.conversation_id = ${alias}.conversation_id
    ), '[]')`;
  }
  return `COALESCE((
    SELECT json_group_array(json(message_json))
    FROM (
      SELECT message_json
      FROM transcript_events te
      WHERE te.tenant_id = ${alias}.tenant_id
        AND te.conversation_id = ${alias}.conversation_id
      ORDER BY te.event_index ASC
    )
  ), '[]')`;
}

function buildContextStateJsonSql(kind: StateStoreKind, alias: string): string {
  if (kind === "postgres") {
    return `COALESCE((
      SELECT jsonb_build_object(
        'version', 1,
        'compacted_through_message_id', cs.pending_json -> 'compacted_through_message_id',
        'recent_message_ids', COALESCE(cs.pending_json -> 'recent_message_ids', '[]'::jsonb),
        'checkpoint', COALESCE(cs.summary_json, 'null'::jsonb),
        'pending_approvals', COALESCE(cs.pending_json -> 'pending_approvals', '[]'::jsonb),
        'pending_tool_state', COALESCE(cs.pending_json -> 'pending_tool_state', '[]'::jsonb),
        'updated_at', to_jsonb(to_char(
          cs.updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ))
      )::text
      FROM conversation_state cs
      WHERE cs.tenant_id = ${alias}.tenant_id
        AND cs.conversation_id = ${alias}.conversation_id
    ), '${EMPTY_CONVERSATION_STATE_JSON}')`;
  }
  return `COALESCE((
    SELECT json_object(
      'version', 1,
      'compacted_through_message_id', json_extract(cs.pending_json, '$.compacted_through_message_id'),
      'recent_message_ids', json(COALESCE(json_extract(cs.pending_json, '$.recent_message_ids'), '[]')),
      'checkpoint', json(COALESCE(cs.summary_json, 'null')),
      'pending_approvals', json(COALESCE(json_extract(cs.pending_json, '$.pending_approvals'), '[]')),
      'pending_tool_state', json(COALESCE(json_extract(cs.pending_json, '$.pending_tool_state'), '[]')),
      'updated_at', cs.updated_at
    )
    FROM conversation_state cs
    WHERE cs.tenant_id = ${alias}.tenant_id
      AND cs.conversation_id = ${alias}.conversation_id
  ), '${EMPTY_CONVERSATION_STATE_JSON}')`;
}

export function buildConversationSelectSql(kind: StateStoreKind, alias = "s"): string {
  return `${alias}.tenant_id,
       ${alias}.conversation_id AS conversation_id,
       ${alias}.conversation_key AS conversation_key,
       ${alias}.agent_id,
       ${alias}.workspace_id,
       ${alias}.channel_thread_id,
       ${alias}.title,
       ${buildMessagesJsonSql(kind, alias)} AS messages_json,
       ${buildContextStateJsonSql(kind, alias)} AS context_state_json,
       ${alias}.archived_at,
       ${alias}.created_at,
       ${alias}.updated_at`;
}

export function buildConversationWithDeliverySql(kind: StateStoreKind): string {
  return `SELECT ${buildConversationSelectSql(kind, "s")},
       ag.agent_key,
       ws.workspace_key,
       ca.connector_key,
       ca.account_key,
       ct.provider_thread_id,
       ct.container_kind
     FROM conversations s
     JOIN agents ag
       ON ag.tenant_id = s.tenant_id
      AND ag.agent_id = s.agent_id
     JOIN workspaces ws
       ON ws.tenant_id = s.tenant_id
      AND ws.workspace_id = s.workspace_id
     JOIN channel_threads ct
       ON ct.tenant_id = s.tenant_id
      AND ct.workspace_id = s.workspace_id
      AND ct.channel_thread_id = s.channel_thread_id
     JOIN channel_accounts ca
       ON ca.tenant_id = ct.tenant_id
      AND ca.workspace_id = ct.workspace_id
      AND ca.channel_account_id = ct.channel_account_id
     WHERE s.tenant_id = ? AND s.conversation_key = ?
     LIMIT 1`;
}

function decomposeConversationState(state: ConversationState): {
  summaryJson: string;
  pendingJson: string;
  updatedAt: string;
} {
  return {
    summaryJson: JSON.stringify(state.checkpoint),
    pendingJson: JSON.stringify({
      compacted_through_message_id: state.compacted_through_message_id ?? null,
      recent_message_ids: state.recent_message_ids,
      pending_approvals: state.pending_approvals,
      pending_tool_state: state.pending_tool_state,
    }),
    updatedAt: state.updated_at,
  };
}

export function normalizeMessageId(message: TyrumUIMessage, index: number): string {
  const normalized = message.id.trim();
  return normalized.length > 0 ? normalized : `message-${String(index)}`;
}

export function resolveMessageCreatedAt(
  message: TyrumUIMessage,
  fallbackCreatedAt: string,
): string {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object") return fallbackCreatedAt;
  const createdAt =
    typeof metadata["created_at"] === "string"
      ? metadata["created_at"]
      : typeof metadata["createdAt"] === "string"
        ? metadata["createdAt"]
        : typeof metadata["timestamp"] === "string"
          ? metadata["timestamp"]
          : undefined;
  return createdAt?.trim() ? createdAt : fallbackCreatedAt;
}

export async function upsertConversationStateTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    conversationId: string;
    contextState: ConversationState;
  },
): Promise<void> {
  const { summaryJson, pendingJson, updatedAt } = decomposeConversationState(input.contextState);
  await tx.run(buildConversationStateUpsertSql(tx.kind), [
    input.tenantId,
    input.conversationId,
    summaryJson,
    pendingJson,
    updatedAt,
  ]);
}

export async function replaceTranscriptEventsTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    conversationId: string;
    messages: readonly TyrumUIMessage[];
    fallbackCreatedAt: string;
  },
): Promise<void> {
  await tx.run("DELETE FROM transcript_events WHERE tenant_id = ? AND conversation_id = ?", [
    input.tenantId,
    input.conversationId,
  ]);
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index]!;
    const messageId = normalizeMessageId(message, index);
    await tx.run(
      `INSERT INTO transcript_events (
         tenant_id,
         transcript_event_id,
         conversation_id,
         event_index,
         event_kind,
         message_id,
         role,
         message_json,
         created_at
       ) VALUES (?, ?, ?, ?, 'message', ?, ?, ?, ?)`,
      [
        input.tenantId,
        `${input.conversationId}:${String(index)}:${messageId}`,
        input.conversationId,
        index,
        messageId,
        message.role,
        JSON.stringify(message),
        resolveMessageCreatedAt(message, input.fallbackCreatedAt),
      ],
    );
  }
}
