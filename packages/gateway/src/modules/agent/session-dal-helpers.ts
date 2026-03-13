import type {
  ChatMessage,
  ChatMessagePreview,
  NormalizedContainerKind,
  SessionContextState,
} from "@tyrum/schemas";
import {
  ChatMessage as ChatMessageSchema,
  SessionContextState as SessionContextStateSchema,
} from "@tyrum/schemas";
import {
  parsePersistedJson,
  reportPersistedJsonReadFailure,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";

const SESSION_TITLE_MAX_CHARS = 120;

export interface SessionRow extends RawSessionTimeFields {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  messages: ChatMessage[];
  context_state: SessionContextState;
  created_at: string;
  updated_at: string;
}

export interface SessionListRow extends RawSessionTimeFields {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  title: string;
  message_count: number;
  last_message: ChatMessagePreview | null;
  created_at: string;
  updated_at: string;
}

export type SessionWithDelivery = {
  session: SessionRow;
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: NormalizedContainerKind;
};

export type RawSessionTimeFields = { created_at: string | Date; updated_at: string | Date };

export interface RawSessionRow extends RawSessionTimeFields {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  messages_json: string;
  context_state_json: string;
}

export interface RawSessionListRow extends RawSessionTimeFields {
  session_id: string;
  session_key: string;
  agent_key: string;
  connector_key: string;
  provider_thread_id: string;
  title: string;
  messages_json: string;
  context_state_json: string;
}

export interface RawSessionWithDeliveryRow extends RawSessionRow {
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: string;
}

export interface SessionDalOptions extends PersistedJsonObserver {}
export type SessionIdentity = { tenantId: string; sessionId: string };
export type { SessionContextState };

export const SESSION_MESSAGES_JSON_META = {
  table: "sessions",
  column: "messages_json",
  shape: "array",
} as const;

export const SESSION_CONTEXT_STATE_JSON_META = {
  table: "sessions",
  column: "context_state_json",
  shape: "object",
} as const;

export const UPDATE_SESSION_SQL =
  "UPDATE sessions SET messages_json = ?, context_state_json = ?, title = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ?";

export const WITH_DELIVERY_SQL = `SELECT s.*, ag.agent_key, ws.workspace_key, ca.connector_key, ca.account_key, ct.provider_thread_id, ct.container_kind FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN workspaces ws ON ws.tenant_id = s.tenant_id AND ws.workspace_id = s.workspace_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE s.tenant_id = ? AND s.session_key = ? LIMIT 1`;

function isChatMessage(value: unknown): value is ChatMessage {
  return ChatMessageSchema.safeParse(value).success;
}

export function createEmptySessionContextState(
  updatedAt = new Date().toISOString(),
): SessionContextState {
  return {
    version: 1,
    recent_message_ids: [],
    checkpoint: null,
    pending_approvals: [],
    pending_tool_state: [],
    updated_at: updatedAt,
  };
}

export function isSessionContextState(value: unknown): value is SessionContextState {
  return SessionContextStateSchema.safeParse(value).success;
}

export function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")
    ? `${trimmed.replace(" ", "T")}Z`
    : value;
}

function firstMessageText(message: ChatMessage): string | undefined {
  for (const part of message.parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type !== "text") continue;
    const text = part["text"];
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }
  return undefined;
}

function extractMessageListPreview(
  raw: string,
  observer: PersistedJsonObserver,
): { messageCount: number; lastMessage: ChatMessagePreview | null } {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_MESSAGES_JSON_META,
    observer,
  });

  let messageCount = 0;
  let invalidItems = 0;
  let lastMessage: ChatMessagePreview | null = null;

  for (const item of parsed) {
    if (!isChatMessage(item)) {
      invalidItems += 1;
      continue;
    }

    messageCount += 1;
    const text = firstMessageText(item);
    if (text) {
      lastMessage = {
        role: item.role,
        content: text,
      };
    }
  }

  if (invalidItems > 0) {
    reportPersistedJsonReadFailure({
      observer,
      ...SESSION_MESSAGES_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  }

  return { messageCount, lastMessage };
}

export function isChatMessageArray(value: unknown): value is ChatMessage[] {
  return Array.isArray(value) && value.every(isChatMessage);
}

export function parseMessages(raw: string, observer: PersistedJsonObserver): ChatMessage[] {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_MESSAGES_JSON_META,
    observer,
  });
  const safe = parsed.filter(isChatMessage);
  const invalidItems = parsed.length - safe.length;
  if (invalidItems > 0) {
    reportPersistedJsonReadFailure({
      observer,
      ...SESSION_MESSAGES_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  }
  return safe;
}

export function parseContextState(
  raw: string,
  observer: PersistedJsonObserver,
  updatedAt: string,
): SessionContextState {
  const parsed = parsePersistedJson<unknown>({
    raw,
    fallback: createEmptySessionContextState(updatedAt),
    ...SESSION_CONTEXT_STATE_JSON_META,
    observer,
  });
  if (isSessionContextState(parsed)) {
    return parsed;
  }
  reportPersistedJsonReadFailure({
    observer,
    ...SESSION_CONTEXT_STATE_JSON_META,
    reason: "invalid_value",
  });
  return createEmptySessionContextState(updatedAt);
}

export function toSessionRow(raw: RawSessionRow, observer: PersistedJsonObserver): SessionRow {
  const updatedAt = normalizeTime(raw.updated_at);
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    session_key: raw.session_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    channel_thread_id: raw.channel_thread_id,
    title: raw.title,
    messages: parseMessages(raw.messages_json, observer),
    context_state: parseContextState(raw.context_state_json, observer, updatedAt),
    created_at: normalizeTime(raw.created_at),
    updated_at: updatedAt,
  };
}

export function normalizeContainerKind(value: string): NormalizedContainerKind {
  return value === "dm" || value === "group" || value === "channel" ? value : "channel";
}

export function toSessionListRow(
  raw: RawSessionListRow,
  observer: PersistedJsonObserver,
): SessionListRow {
  const { messageCount, lastMessage } = extractMessageListPreview(raw.messages_json, observer);
  return {
    agent_id: raw.agent_key,
    session_id: raw.session_key,
    channel: raw.connector_key,
    thread_id: raw.provider_thread_id,
    title: raw.title,
    message_count: messageCount,
    last_message: lastMessage ? { role: lastMessage.role, content: lastMessage.content } : null,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export function normalizeSessionTitle(value: string): string {
  const [firstLine = ""] = value.replaceAll("\r", "").split("\n");
  const trimmed = firstLine.trim();
  return trimmed.slice(0, SESSION_TITLE_MAX_CHARS);
}
