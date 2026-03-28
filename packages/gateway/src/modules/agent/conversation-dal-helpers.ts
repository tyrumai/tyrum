import type {
  ConversationState,
  NormalizedContainerKind,
  TyrumUIMessage,
  TyrumUIMessagePreview,
} from "@tyrum/contracts";
import {
  ConversationState as ConversationStateSchema,
  DateTimeSchema,
  TyrumUIMessage as ChatMessageSchema,
} from "@tyrum/contracts";
import {
  parsePersistedJson,
  reportPersistedJsonReadFailure,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";
import {
  EMPTY_CONVERSATION_STATE,
  CONVERSATION_CONTEXT_STATE_JSON_META,
  CONVERSATION_MESSAGES_JSON_META,
} from "./conversation-dal-storage.js";

const CONVERSATION_TITLE_MAX_CHARS = 120;
const LOW_SIGNAL_CONVERSATION_TITLES = new Set([
  "chat",
  "conversation",
  "help",
  "need help",
  "new conversation",
  "question",
  "conversation",
  "task",
  "untitled",
]);

export interface ConversationRow extends RawConversationTimeFields {
  tenant_id: string;
  conversation_id: string;
  conversation_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  messages: TyrumUIMessage[];
  context_state: ConversationState;
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

export interface ConversationListRow extends RawConversationTimeFields {
  agent_key: string;
  conversation_id: string;
  conversation_key: string;
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

export type ConversationWithDelivery = {
  conversation: ConversationRow;
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: NormalizedContainerKind;
};

export type RawConversationTimeFields = { created_at: string | Date; updated_at: string | Date };

export interface RawConversationRow extends RawConversationTimeFields {
  tenant_id: string;
  conversation_id: string;
  conversation_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  messages_json: string;
  context_state_json: string;
  archived_at: string | null;
}

export interface RawConversationListRow extends RawConversationTimeFields {
  conversation_id: string;
  conversation_key: string;
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

export interface RawConversationWithDeliveryRow extends RawConversationRow {
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: string;
}

export interface ConversationDalOptions extends PersistedJsonObserver {}
export type ConversationIdentity = { tenantId: string; conversationId: string };
export type { ConversationState };

export {
  buildConversationSelectSql,
  buildConversationWithDeliverySql,
  replaceTranscriptEventsTx,
  CONVERSATION_CONTEXT_STATE_JSON_META,
  CONVERSATION_MESSAGES_JSON_META,
  upsertConversationStateTx,
} from "./conversation-dal-storage.js";

function isChatMessage(value: unknown): value is TyrumUIMessage {
  return ChatMessageSchema.safeParse(value).success;
}

export function createEmptyConversationContextState(
  updatedAt = new Date().toISOString(),
): ConversationState {
  return {
    version: EMPTY_CONVERSATION_STATE.version,
    recent_message_ids: [...EMPTY_CONVERSATION_STATE.recent_message_ids],
    checkpoint: EMPTY_CONVERSATION_STATE.checkpoint,
    pending_approvals: [...EMPTY_CONVERSATION_STATE.pending_approvals],
    pending_tool_state: [...EMPTY_CONVERSATION_STATE.pending_tool_state],
    updated_at: updatedAt,
  };
}

export function isConversationContextState(value: unknown): value is ConversationState {
  return ConversationStateSchema.safeParse(value).success;
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
    ...CONVERSATION_MESSAGES_JSON_META,
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
      ...CONVERSATION_MESSAGES_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  }

  return { messageCount, lastMessage };
}

function textTranscript(
  messages: readonly TyrumUIMessage[],
  fallbackCreatedAt: string,
): ConversationRow["transcript"] {
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
    ...CONVERSATION_MESSAGES_JSON_META,
    observer,
  });
  const safe = parsed.filter(isChatMessage);
  const invalidItems = parsed.length - safe.length;
  if (invalidItems > 0) {
    reportPersistedJsonReadFailure({
      observer,
      ...CONVERSATION_MESSAGES_JSON_META,
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
): ConversationState {
  const parsed = parsePersistedJson<unknown>({
    raw,
    fallback: createEmptyConversationContextState(updatedAt),
    ...CONVERSATION_CONTEXT_STATE_JSON_META,
    observer,
  });
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const normalized = { ...parsed } as Record<string, unknown>;
    const compactedThroughMessageId = normalized["compacted_through_message_id"];
    if (compactedThroughMessageId === null) {
      delete normalized["compacted_through_message_id"];
    }
    normalized["updated_at"] = normalizeContextStateUpdatedAt(normalized["updated_at"]);
    if (isConversationContextState(normalized)) {
      return normalized;
    }
  } else if (isConversationContextState(parsed)) {
    return parsed;
  }
  reportPersistedJsonReadFailure({
    observer,
    ...CONVERSATION_CONTEXT_STATE_JSON_META,
    reason: "invalid_value",
  });
  return createEmptyConversationContextState(updatedAt);
}

function normalizeContextStateUpdatedAt(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const normalized = normalizeTime(trimmed);
  if (DateTimeSchema.safeParse(normalized).success) {
    return normalized;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function toConversationRow(raw: RawConversationRow, observer: PersistedJsonObserver): ConversationRow {
  const updatedAt = normalizeTime(raw.updated_at);
  const createdAt = normalizeTime(raw.created_at);
  const messages = parseMessages(raw.messages_json, observer);
  const contextState = parseContextState(raw.context_state_json, observer, updatedAt);
  return {
    tenant_id: raw.tenant_id,
    conversation_id: raw.conversation_id,
    conversation_key: raw.conversation_key,
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

export function toConversationListRow(
  raw: RawConversationListRow,
  observer: PersistedJsonObserver,
): ConversationListRow {
  const { messageCount, lastMessage } = extractMessageListPreview(raw.messages_json, observer);
  return {
    agent_key: raw.agent_key,
    conversation_id: raw.conversation_id,
    conversation_key: raw.conversation_key,
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

export function normalizeConversationTitle(value: string): string {
  const [firstLine = ""] = value.replaceAll("\r", "").split("\n");
  const trimmed = firstLine.trim();
  const truncated = trimmed.slice(0, CONVERSATION_TITLE_MAX_CHARS);
  const normalized = truncated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (LOW_SIGNAL_CONVERSATION_TITLES.has(normalized)) {
    return "";
  }
  return truncated;
}
