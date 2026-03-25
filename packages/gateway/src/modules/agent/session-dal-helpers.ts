import type {
  TyrumUIMessage,
  TyrumUIMessagePreview,
  NormalizedContainerKind,
  SessionContextState,
} from "@tyrum/contracts";
import {
  TyrumUIMessage as ChatMessageSchema,
  SessionContextState as SessionContextStateSchema,
} from "@tyrum/contracts";
import {
  parsePersistedJson,
  reportPersistedJsonReadFailure,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";

const SESSION_TITLE_MAX_CHARS = 120;
const LOW_SIGNAL_SESSION_TITLES = new Set([
  "chat",
  "conversation",
  "help",
  "need help",
  "new conversation",
  "question",
  "session",
  "task",
  "untitled",
]);

export interface SessionRow extends RawSessionTimeFields {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  messages: TyrumUIMessage[];
  context_state: SessionContextState;
  summary: string;
  transcript: Array<{
    kind: "text";
    id: string;
    role: TyrumUIMessage["role"];
    content: string;
    created_at: string;
  }>;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionListRow extends RawSessionTimeFields {
  agent_key: string;
  session_id: string;
  channel: string;
  account_key?: string;
  thread_id: string;
  container_kind?: NormalizedContainerKind;
  title: string;
  message_count: number;
  last_message: TyrumUIMessagePreview | null;
  transcript_count: number;
  last_text: TyrumUIMessagePreview | null;
  archived: boolean;
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
  archived_at: string | null;
}

export interface RawSessionListRow extends RawSessionTimeFields {
  session_id: string;
  session_key: string;
  agent_key: string;
  connector_key: string;
  account_key?: string;
  provider_thread_id: string;
  container_kind?: string;
  title: string;
  messages_json: string;
  context_state_json: string;
  archived_at: string | null;
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

function isChatMessage(value: unknown): value is TyrumUIMessage {
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

function firstMessageText(message: TyrumUIMessage): string | undefined {
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
): { messageCount: number; lastMessage: TyrumUIMessagePreview | null } {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_MESSAGES_JSON_META,
    observer,
  });

  let messageCount = 0;
  let invalidItems = 0;
  let lastMessage: TyrumUIMessagePreview | null = null;

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

function textTranscript(
  messages: readonly TyrumUIMessage[],
  fallbackCreatedAt: string,
): SessionRow["transcript"] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part: TyrumUIMessage["parts"][number]) =>
      part.type === "text" && typeof part.text === "string" && part.text.length > 0
        ? [
            {
              kind: "text" as const,
              id: message.id,
              role: message.role,
              content: part.text,
              created_at:
                typeof message.metadata?.["timestamp"] === "string"
                  ? message.metadata["timestamp"]
                  : fallbackCreatedAt,
            },
          ]
        : [],
    ),
  );
}

export function isChatMessageArray(value: unknown): value is TyrumUIMessage[] {
  return Array.isArray(value) && value.every(isChatMessage);
}

export function parseMessages(raw: string, observer: PersistedJsonObserver): TyrumUIMessage[] {
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
  const createdAt = normalizeTime(raw.created_at);
  const messages = parseMessages(raw.messages_json, observer);
  const contextState = parseContextState(raw.context_state_json, observer, updatedAt);
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    session_key: raw.session_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    channel_thread_id: raw.channel_thread_id,
    title: raw.title,
    messages,
    context_state: contextState,
    summary: contextState.checkpoint?.handoff_md ?? "",
    transcript: textTranscript(messages, updatedAt),
    archived: raw.archived_at !== null,
    created_at: createdAt,
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
    agent_key: raw.agent_key,
    session_id: raw.session_key,
    channel: raw.connector_key,
    account_key: raw.account_key,
    thread_id: raw.provider_thread_id,
    container_kind: raw.container_kind ? normalizeContainerKind(raw.container_kind) : undefined,
    title: raw.title,
    message_count: messageCount,
    last_message: lastMessage ? { role: lastMessage.role, content: lastMessage.content } : null,
    transcript_count: messageCount,
    last_text: lastMessage ? { role: lastMessage.role, content: lastMessage.content } : null,
    archived: raw.archived_at !== null,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export function normalizeSessionTitle(value: string): string {
  const [firstLine = ""] = value.replaceAll("\r", "").split("\n");
  const trimmed = firstLine.trim();
  const truncated = trimmed.slice(0, SESSION_TITLE_MAX_CHARS);
  const normalized = truncated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (LOW_SIGNAL_SESSION_TITLES.has(normalized)) {
    return "";
  }
  return truncated;
}
