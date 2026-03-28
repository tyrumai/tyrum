import { newDb } from "pg-mem";

const CONVERSATION_TURN_CLEAN_BREAK_MIGRATION_MARKERS = [
  "CREATE UNIQUE INDEX conversations_tenant_conversation_id_uq",
  "CREATE TABLE conversation_state (",
  "ALTER TABLE conversations DROP COLUMN messages_json;",
] as const;

let applyingConversationTurnCleanBreakMigration = false;

type ConversationTurnCleanBreakLegacyConversationRow = {
  tenant_id: string;
  conversation_id: string;
  conversation_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string | null;
  context_state_json: unknown;
  messages_json: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export function isConversationTurnCleanBreakMigration(sql: string): boolean {
  return CONVERSATION_TURN_CLEAN_BREAK_MIGRATION_MARKERS.every((marker) => sql.includes(marker));
}

export function isApplyingConversationTurnCleanBreakMigration(): boolean {
  return applyingConversationTurnCleanBreakMigration;
}

export function toJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function coerceArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseLegacyMessagesJson(messagesJson: string | null): unknown[] {
  if (typeof messagesJson !== "string" || messagesJson.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(messagesJson) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function applyConversationTurnCleanBreakMigration(input: {
  mem: ReturnType<typeof newDb>;
  toSqlTextLiteral: (value: unknown) => string;
}): void {
  const { mem, toSqlTextLiteral } = input;
  applyingConversationTurnCleanBreakMigration = true;
  try {
    const conversations = mem.public.many<ConversationTurnCleanBreakLegacyConversationRow>(
      `SELECT
         tenant_id,
         conversation_id,
         conversation_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         title,
         context_state_json,
         messages_json,
         created_at,
         updated_at,
         archived_at
       FROM conversations`,
    );
    const statements = [
      "CREATE UNIQUE INDEX conversations_tenant_conversation_id_uq ON conversations (tenant_id, conversation_id)",
      "CREATE UNIQUE INDEX turns_tenant_turn_id_uq ON turns (tenant_id, turn_id)",
      `CREATE TABLE conversation_state (
         tenant_id        UUID NOT NULL,
         conversation_id  UUID NOT NULL,
         summary_json     JSONB NOT NULL DEFAULT 'null'::jsonb,
         pending_json     JSONB NOT NULL DEFAULT '{"compacted_through_message_id":null,"recent_message_ids":[],"pending_approvals":[],"pending_tool_state":[]}'::jsonb,
         updated_at       TIMESTAMPTZ NOT NULL,
         PRIMARY KEY (tenant_id, conversation_id)
       )`,
      `CREATE TABLE transcript_events (
         tenant_id            UUID NOT NULL,
         transcript_event_id  TEXT NOT NULL,
         conversation_id      UUID NOT NULL,
         event_index          INTEGER NOT NULL CHECK (event_index >= 0),
         event_kind           TEXT NOT NULL CHECK (event_kind IN ('message')),
         message_id           TEXT NOT NULL,
         role                 TEXT NOT NULL,
         message_json         TEXT NOT NULL,
         created_at           TIMESTAMPTZ NOT NULL,
         PRIMARY KEY (tenant_id, transcript_event_id),
         UNIQUE (tenant_id, conversation_id, event_index)
       )`,
      "CREATE INDEX transcript_events_conversation_idx ON transcript_events (tenant_id, conversation_id, created_at ASC, event_index ASC)",
    ];
    for (const statement of statements) {
      mem.public.none(statement);
    }

    for (const conversation of conversations) {
      const contextState = coerceRecord(conversation.context_state_json);
      const pendingJson = {
        compacted_through_message_id: contextState?.["compacted_through_message_id"] ?? null,
        recent_message_ids: coerceArray(contextState?.["recent_message_ids"]),
        pending_approvals: coerceArray(contextState?.["pending_approvals"]),
        pending_tool_state: coerceArray(contextState?.["pending_tool_state"]),
      };
      const stateUpdatedAt =
        typeof contextState?.["updated_at"] === "string" && contextState["updated_at"].trim()
          ? contextState["updated_at"].trim()
          : conversation.updated_at;

      mem.public.none(
        `INSERT INTO conversation_state (
           tenant_id,
           conversation_id,
           summary_json,
           pending_json,
           updated_at
         ) VALUES (
           ${toSqlTextLiteral(conversation.tenant_id)},
           ${toSqlTextLiteral(conversation.conversation_id)},
           ${toSqlTextLiteral(JSON.stringify(contextState?.["checkpoint"] ?? null))}::jsonb,
           ${toSqlTextLiteral(JSON.stringify(pendingJson))}::jsonb,
           ${toSqlTextLiteral(stateUpdatedAt)}
         )`,
      );

      const messages = parseLegacyMessagesJson(conversation.messages_json);
      messages.forEach((message, index) => {
        const messageRecord = coerceRecord(message);
        const metadata = coerceRecord(messageRecord?.["metadata"]);
        const fallbackMessageId = `message-${String(index)}`;
        const messageId =
          typeof messageRecord?.["id"] === "string" && messageRecord["id"].trim().length > 0
            ? messageRecord["id"].trim()
            : fallbackMessageId;
        const role =
          typeof messageRecord?.["role"] === "string" && messageRecord["role"].trim().length > 0
            ? messageRecord["role"].trim()
            : "assistant";
        const createdAtCandidates = [
          typeof metadata?.["created_at"] === "string" ? metadata["created_at"] : null,
          typeof metadata?.["createdAt"] === "string" ? metadata["createdAt"] : null,
          typeof metadata?.["timestamp"] === "string" ? metadata["timestamp"] : null,
        ];
        const createdAt =
          createdAtCandidates.find(
            (candidate): candidate is string =>
              typeof candidate === "string" && candidate.trim().length > 0,
          ) ?? conversation.updated_at;

        mem.public.none(
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
           ) VALUES (
             ${toSqlTextLiteral(conversation.tenant_id)},
             ${toSqlTextLiteral(`${conversation.conversation_id}:${messageId}`)},
             ${toSqlTextLiteral(conversation.conversation_id)},
             ${index},
             'message',
             ${toSqlTextLiteral(messageId)},
             ${toSqlTextLiteral(role)},
             ${toSqlTextLiteral(JSON.stringify(message) ?? "null")},
             ${toSqlTextLiteral(createdAt)}
           )`,
        );
      });
    }

    mem.public.none("ALTER TABLE conversations DROP COLUMN messages_json");
    mem.public.none("ALTER TABLE conversations DROP COLUMN context_state_json");
  } finally {
    applyingConversationTurnCleanBreakMigration = false;
  }
}

export function parseJsonbSetPath(pathText: string): string[] {
  const trimmed = pathText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((segment) => segment.trim().replace(/^"(.*)"$/, "$1"));
}

function parseJsonbBuildObjectValue(value: string | null): unknown {
  if (value === null) return null;
  const trimmed = value.trim();
  if (
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function buildJsonbObjectFromTextArgs(
  args: readonly (string | null)[],
): Record<string, unknown> {
  if (args.length % 2 !== 0) {
    throw new Error("jsonb_build_object requires alternating key/value pairs");
  }

  const result: Record<string, unknown> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (typeof key !== "string") {
      throw new Error("jsonb_build_object keys must be text");
    }
    result[key] = parseJsonbBuildObjectValue(args[index + 1] ?? null);
  }
  return result;
}

export function setJsonbPath(
  value: unknown,
  path: readonly string[],
  replacement: unknown,
  createMissing: boolean,
): unknown {
  if (path.length === 0) {
    return structuredClone(value);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (!createMissing) return structuredClone(value);
    value = {};
  }

  const clone = structuredClone(value as Record<string, unknown>);
  let cursor = clone as Record<string, unknown>;

  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      if (!createMissing) return clone;
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[path.at(-1) ?? ""] = structuredClone(replacement);
  return clone;
}
