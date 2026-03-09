import type {
  NormalizedContainerKind,
  SessionTranscriptItem,
  SessionTranscriptTextItem,
  SessionTranscriptTextPreview,
} from "@tyrum/schemas";
import {
  parsePersistedJson,
  reportPersistedJsonReadFailure,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";
import {
  SessionTranscriptItem as SessionTranscriptItemSchema,
  SessionTranscriptTextItem as SessionTranscriptTextItemSchema,
} from "@tyrum/schemas";

const SESSION_TITLE_MAX_CHARS = 120;
export interface SessionRow extends RawSessionTimeFields {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  title: string;
  summary: string;
  transcript: SessionTranscriptItem[];
  created_at: string;
  updated_at: string;
}
export interface SessionListRow extends RawSessionTimeFields {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  title: string;
  summary: string;
  transcript_count: number;
  last_text: SessionTranscriptTextPreview | null;
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
  summary: string;
  transcript_json: string;
}
export interface RawSessionListRow extends RawSessionTimeFields {
  session_id: string;
  session_key: string;
  agent_key: string;
  connector_key: string;
  provider_thread_id: string;
  title: string;
  summary: string;
  transcript_json: string;
}
export interface RawSessionWithDeliveryRow extends RawSessionRow {
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: string;
}
export interface RawChannelTranscriptRow {
  inbox_id: number;
  payload_json: string;
  reply_text: string | null;
  processed_at: string | Date | null;
}

export interface SessionDalOptions extends PersistedJsonObserver {}
export interface SessionRepairResult {
  source_rows: number;
  rebuilt_messages: number;
  kept_messages: number;
  dropped_messages: number;
}

export type StoredTranscript = {
  transcript: SessionTranscriptItem[];
  title: string;
  summary: string;
  droppedMessages: number;
};
export type SessionIdentity = { tenantId: string; sessionId: string };

export const SESSION_TURNS_JSON_META = {
  table: "sessions",
  column: "transcript_json",
  shape: "array",
} as const;
export const UPDATE_SESSION_SQL =
  "UPDATE sessions SET transcript_json = ?, title = ?, summary = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ?";
export const REPAIR_SESSION_SQL =
  "SELECT inbox_id, payload_json, reply_text, processed_at FROM channel_inbox WHERE tenant_id = ? AND session_id = ? AND status = 'completed' ORDER BY received_at_ms ASC, inbox_id ASC";
export const WITH_DELIVERY_SQL = `SELECT s.*, ag.agent_key, ws.workspace_key, ca.connector_key, ca.account_key, ct.provider_thread_id, ct.container_kind FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN workspaces ws ON ws.tenant_id = s.tenant_id AND ws.workspace_id = s.workspace_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE s.tenant_id = ? AND s.session_key = ? LIMIT 1`;

export function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")
    ? `${trimmed.replace(" ", "T")}Z`
    : value;
}

function isSessionTranscriptItem(value: unknown): value is SessionTranscriptItem {
  return SessionTranscriptItemSchema.safeParse(value).success;
}

function isSessionTranscriptTextItem(value: unknown): value is SessionTranscriptTextItem {
  return SessionTranscriptTextItemSchema.safeParse(value).success;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTranscriptRole(value: unknown): value is SessionTranscriptTextItem["role"] {
  return value === "assistant" || value === "system" || value === "user";
}

function isToolStatus(value: unknown): boolean {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "awaiting_approval"
  );
}

function isApprovalStatus(value: unknown): boolean {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "denied" ||
    value === "expired" ||
    value === "cancelled"
  );
}

function hasStringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string";
}

type SessionTranscriptListPreviewItem =
  | {
      kind: "text";
      role: SessionTranscriptTextItem["role"];
      content: string;
    }
  | { kind: "tool" }
  | { kind: "approval" };

function isSessionTranscriptItemPreview(value: unknown): value is SessionTranscriptListPreviewItem {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;

  if (value["kind"] === "text") {
    return (
      hasStringField(value, "id") &&
      isTranscriptRole(value["role"]) &&
      hasStringField(value, "content") &&
      hasStringField(value, "created_at")
    );
  }

  if (value["kind"] === "tool") {
    return (
      hasStringField(value, "id") &&
      hasStringField(value, "tool_id") &&
      hasStringField(value, "tool_call_id") &&
      isToolStatus(value["status"]) &&
      hasStringField(value, "summary") &&
      hasStringField(value, "created_at") &&
      hasStringField(value, "updated_at")
    );
  }

  if (value["kind"] === "approval") {
    return (
      hasStringField(value, "id") &&
      hasStringField(value, "approval_id") &&
      isApprovalStatus(value["status"]) &&
      hasStringField(value, "title") &&
      hasStringField(value, "detail") &&
      hasStringField(value, "created_at") &&
      hasStringField(value, "updated_at")
    );
  }

  return false;
}

function extractTranscriptListPreview(
  raw: string,
  observer: PersistedJsonObserver,
): { transcriptCount: number; lastText: SessionTranscriptTextPreview | null } {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_TURNS_JSON_META,
    observer,
  });

  let transcriptCount = 0;
  let invalidItems = 0;
  let lastText: SessionTranscriptTextPreview | null = null;

  for (const item of parsed) {
    if (!isSessionTranscriptItemPreview(item)) {
      invalidItems += 1;
      continue;
    }

    transcriptCount += 1;
    if (item.kind === "text") {
      lastText = {
        role: item.role,
        content: item.content,
      };
    }
  }

  if (invalidItems > 0) {
    reportPersistedJsonReadFailure({
      observer,
      ...SESSION_TURNS_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  }

  return { transcriptCount, lastText };
}

export function isSessionTranscriptArray(value: unknown): value is SessionTranscriptItem[] {
  return Array.isArray(value) && value.every(isSessionTranscriptItem);
}

export function parseTranscript(
  raw: string,
  observer: PersistedJsonObserver,
): SessionTranscriptItem[] {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_TURNS_JSON_META,
    observer,
  });
  const safe = parsed.filter(isSessionTranscriptItem);
  const invalidItems = parsed.length - safe.length;
  if (invalidItems > 0)
    reportPersistedJsonReadFailure({
      observer,
      ...SESSION_TURNS_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  return safe;
}

export function toSessionRow(raw: RawSessionRow, observer: PersistedJsonObserver): SessionRow {
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    session_key: raw.session_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    channel_thread_id: raw.channel_thread_id,
    title: raw.title,
    summary: raw.summary,
    transcript: parseTranscript(raw.transcript_json, observer),
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export function normalizeContainerKind(value: string): NormalizedContainerKind {
  return value === "dm" || value === "group" || value === "channel" ? value : "channel";
}

export function toSessionListRow(
  raw: RawSessionListRow,
  observer: PersistedJsonObserver,
): SessionListRow {
  const { transcriptCount, lastText } = extractTranscriptListPreview(raw.transcript_json, observer);
  return {
    agent_id: raw.agent_key,
    session_id: raw.session_key,
    channel: raw.connector_key,
    thread_id: raw.provider_thread_id,
    title: raw.title,
    summary: raw.summary,
    transcript_count: transcriptCount,
    last_text: lastText ? { role: lastText.role, content: lastText.content } : null,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

function trimTo(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function normalizeSessionTitle(value: string): string {
  const [firstLine = ""] = value.replaceAll("\r", "").split("\n");
  const trimmed = firstLine.trim();
  return trimmed.slice(0, SESSION_TITLE_MAX_CHARS);
}

function compactSessionSummary(
  previousSummary: string,
  droppedItems: readonly SessionTranscriptItem[],
  opts?: { maxLines?: number; maxChars?: number; maxLineChars?: number },
): string {
  const maxLines = Math.max(10, opts?.maxLines ?? 200);
  const maxChars = Math.max(200, opts?.maxChars ?? 6000);
  const maxLineChars = Math.max(40, opts?.maxLineChars ?? 240);
  const prevLines = previousSummary.trim().length > 0 ? previousSummary.trim().split("\n") : [];
  const droppedTurns = droppedItems.filter(isSessionTranscriptTextItem);
  let lines = [
    ...prevLines,
    ...droppedTurns.map(
      (turn) =>
        `${turn.role === "assistant" ? "A" : turn.role === "system" ? "S" : "U"} ${turn.created_at}: ${trimTo(turn.content.trim(), maxLineChars)}`,
    ),
  ];
  if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
  while (lines.length > 1 && lines.join("\n").length > maxChars) lines = lines.slice(1);
  return lines.join("\n");
}

export function countTextTranscriptItems(transcript: readonly SessionTranscriptItem[]): number {
  let count = 0;
  for (const item of transcript) {
    if (item.kind === "text") count += 1;
  }
  return count;
}

export function splitTranscriptForCompaction(input: {
  transcript: readonly SessionTranscriptItem[];
  keepLastMessages: number;
}): {
  dropped: SessionTranscriptItem[];
  kept: SessionTranscriptItem[];
} {
  const keepLastMessages = Math.max(0, input.keepLastMessages);
  let splitIndex = input.transcript.length;
  let remainingTextToKeep = keepLastMessages;
  let preservingSuffix = true;
  for (let index = input.transcript.length - 1; index >= 0; index -= 1) {
    const item = input.transcript[index];
    if (!item) continue;
    if (item.kind !== "text") {
      if (preservingSuffix) {
        splitIndex = index;
      }
      continue;
    }
    if (remainingTextToKeep > 0) {
      splitIndex = index;
      remainingTextToKeep -= 1;
      continue;
    }
    preservingSuffix = false;
    break;
  }

  return {
    dropped: input.transcript.slice(0, splitIndex),
    kept: input.transcript.slice(splitIndex),
  };
}

export function buildStoredTranscript(input: {
  transcript: readonly SessionTranscriptItem[];
  keepLastMessages: number;
  previousSummary?: string;
  previousTitle?: string;
}): StoredTranscript {
  const { dropped, kept: transcript } = splitTranscriptForCompaction({
    transcript: input.transcript,
    keepLastMessages: input.keepLastMessages,
  });
  const previousSummary = input.previousSummary ?? "";
  const previousTitle = normalizeSessionTitle(input.previousTitle ?? "");
  return {
    transcript: transcript.slice(),
    title: previousTitle,
    summary: dropped.length > 0 ? compactSessionSummary(previousSummary, dropped) : previousSummary,
    droppedMessages: countTextTranscriptItems(dropped),
  };
}

export function normalizeRepairTimestamp(
  processedAt: string | Date | null,
  fallbackTimestamp: string | undefined,
): string {
  return processedAt
    ? normalizeTime(processedAt)
    : fallbackTimestamp?.trim() || new Date().toISOString();
}
