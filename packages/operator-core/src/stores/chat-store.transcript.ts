import type {
  SessionTranscriptApprovalItem,
  SessionTranscriptReasoningItem,
  SessionTranscriptTextItem,
  SessionTranscriptToolItem,
} from "@tyrum/client";
import type { ChatReasoningTranscriptItem, ChatSession } from "./chat-store.types.js";

type ChatTranscriptItem = ChatSession["transcript"][number];
type TextContentPreference = "primary" | "overlay";

function earliestIso(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function latestIso(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function preferLongerString(primary: string, overlay: string): string {
  return overlay.length > primary.length ? overlay : primary;
}

export function transcriptDisplayOrderTimestamp(item: ChatTranscriptItem): string {
  return item.created_at;
}

function mergeTextItems(
  primary: SessionTranscriptTextItem,
  overlay: SessionTranscriptTextItem,
  textContentPreference: TextContentPreference,
): SessionTranscriptTextItem {
  const winner = textContentPreference === "overlay" ? overlay : primary;
  return {
    ...primary,
    ...winner,
    content: winner.content,
    created_at: earliestIso(primary.created_at, overlay.created_at),
  };
}

function mergeReasoningItems(
  primary: ChatReasoningTranscriptItem | SessionTranscriptReasoningItem,
  overlay: ChatReasoningTranscriptItem | SessionTranscriptReasoningItem,
): ChatReasoningTranscriptItem {
  const winner = overlay.updated_at.localeCompare(primary.updated_at) > 0 ? overlay : primary;
  return {
    ...primary,
    ...winner,
    kind: "reasoning",
    content: preferLongerString(primary.content, overlay.content),
    created_at: earliestIso(primary.created_at, overlay.created_at),
    updated_at: latestIso(primary.updated_at, overlay.updated_at),
  };
}

function mergeToolItems(
  primary: SessionTranscriptToolItem,
  overlay: SessionTranscriptToolItem,
): SessionTranscriptToolItem {
  const overlayIsNewer = overlay.updated_at.localeCompare(primary.updated_at) > 0;
  const winner = overlayIsNewer ? overlay : primary;
  const loser = overlayIsNewer ? primary : overlay;
  const nextSummary = winner.summary.trim().length > 0 ? winner.summary : loser.summary;
  const nextError =
    winner.error && winner.error.trim().length > 0 ? winner.error : (loser.error ?? "");
  return {
    ...primary,
    ...winner,
    summary: nextSummary,
    created_at: earliestIso(primary.created_at, overlay.created_at),
    updated_at: latestIso(primary.updated_at, overlay.updated_at),
    ...(nextError ? { error: nextError } : {}),
  };
}

function mergeApprovalItems(
  primary: SessionTranscriptApprovalItem,
  overlay: SessionTranscriptApprovalItem,
): SessionTranscriptApprovalItem {
  const winner = overlay.updated_at.localeCompare(primary.updated_at) > 0 ? overlay : primary;
  return {
    ...primary,
    ...winner,
    detail: preferLongerString(primary.detail, overlay.detail),
    created_at: earliestIso(primary.created_at, overlay.created_at),
    updated_at: latestIso(primary.updated_at, overlay.updated_at),
  };
}

function mergeTranscriptItem(
  primary: ChatTranscriptItem,
  overlay: ChatTranscriptItem,
  input: {
    textContentPreference: TextContentPreference;
  },
): ChatTranscriptItem {
  if (primary.kind !== overlay.kind) return primary;
  switch (primary.kind) {
    case "text":
      return mergeTextItems(
        primary,
        overlay as SessionTranscriptTextItem,
        input.textContentPreference,
      );
    case "reasoning":
      return mergeReasoningItems(primary, overlay as ChatReasoningTranscriptItem);
    case "tool":
      return mergeToolItems(primary, overlay as SessionTranscriptToolItem);
    case "approval":
      return mergeApprovalItems(primary, overlay as SessionTranscriptApprovalItem);
  }
}

export function sortTranscriptItems(
  transcript: readonly ChatTranscriptItem[],
): ChatTranscriptItem[] {
  return [...transcript].toSorted((left, right) => {
    const leftAt = transcriptDisplayOrderTimestamp(left);
    const rightAt = transcriptDisplayOrderTimestamp(right);
    if (leftAt === rightAt) return 0;
    return leftAt.localeCompare(rightAt);
  });
}

export function mergeTranscriptEntries(
  primary: readonly ChatTranscriptItem[],
  overlay: readonly ChatTranscriptItem[],
  input: {
    textContentPreference?: TextContentPreference;
  } = {},
): ChatTranscriptItem[] {
  if (primary.length === 0 && overlay.length === 0) return [];
  const merged = [...primary];
  const indexById = new Map<string, number>();
  const textContentPreference = input.textContentPreference ?? "overlay";

  for (const [index, item] of merged.entries()) {
    indexById.set(item.id, index);
  }

  for (const item of overlay) {
    const existingIndex = indexById.get(item.id);
    if (existingIndex === undefined) {
      indexById.set(item.id, merged.length);
      merged.push(item);
      continue;
    }
    const existing = merged[existingIndex];
    if (!existing) continue;
    merged[existingIndex] = mergeTranscriptItem(existing, item, {
      textContentPreference,
    });
  }

  return sortTranscriptItems(merged);
}

export function mergeFetchedTranscript(
  previous: readonly ChatTranscriptItem[] | undefined,
  fetched: readonly ChatTranscriptItem[],
): ChatTranscriptItem[] {
  return mergeTranscriptEntries(fetched, previous ?? [], {
    textContentPreference: "primary",
  });
}

export function upsertTranscriptEntries(
  transcript: readonly ChatTranscriptItem[],
  item: ChatTranscriptItem,
): ChatTranscriptItem[] {
  return mergeTranscriptEntries(transcript, [item]);
}

export function removeTranscriptEntriesById(
  transcript: readonly ChatTranscriptItem[],
  ids: ReadonlySet<string>,
): ChatTranscriptItem[] {
  if (ids.size === 0) return [...transcript];
  return transcript.filter((item) => !ids.has(item.id));
}

export function upsertTranscriptItem(session: ChatSession, item: ChatTranscriptItem): ChatSession {
  return {
    ...session,
    transcript: upsertTranscriptEntries(session.transcript, item),
  };
}

export function appendTranscriptTextItem(
  session: ChatSession,
  input: {
    id: string;
    role: SessionTranscriptTextItem["role"];
    content: string;
    createdAt: string;
  },
): ChatSession {
  return upsertTranscriptItem(session, {
    kind: "text",
    id: input.id,
    role: input.role,
    content: input.content,
    created_at: input.createdAt,
  });
}

export function appendTranscriptTextDelta(
  session: ChatSession,
  input: {
    id: string;
    role: SessionTranscriptTextItem["role"];
    delta: string;
    occurredAt: string;
  },
): ChatSession {
  const existing = session.transcript.find(
    (item): item is SessionTranscriptTextItem => item.kind === "text" && item.id === input.id,
  );
  return appendTranscriptTextItem(session, {
    id: input.id,
    role: input.role,
    content: `${existing?.content ?? ""}${input.delta}`,
    createdAt: existing?.created_at ?? input.occurredAt,
  });
}

export function appendTranscriptReasoningDelta(
  session: ChatSession,
  input: {
    id: string;
    delta: string;
    occurredAt: string;
  },
): ChatSession {
  const existing = session.transcript.find(
    (item): item is ChatReasoningTranscriptItem =>
      item.kind === "reasoning" && item.id === input.id,
  );
  return upsertTranscriptItem(session, {
    kind: "reasoning",
    id: input.id,
    content: `${existing?.content ?? ""}${input.delta}`,
    created_at: existing?.created_at ?? input.occurredAt,
    updated_at: input.occurredAt,
  });
}

export function activeToolCallIdsForSession(session: ChatSession | null): string[] {
  if (!session) return [];
  return session.transcript
    .filter(
      (item): item is SessionTranscriptToolItem =>
        item.kind === "tool" &&
        (item.status === "queued" ||
          item.status === "running" ||
          item.status === "awaiting_approval"),
    )
    .map((item) => item.tool_call_id);
}

export function eventOccurredAt(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return new Date().toISOString();
  const occurredAt = (data as Record<string, unknown>)["occurred_at"];
  return typeof occurredAt === "string" && occurredAt.trim().length > 0
    ? occurredAt
    : new Date().toISOString();
}

export function readApprovalSessionId(payload: Record<string, unknown> | null): string | null {
  const approval = payload?.["approval"];
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return null;
  const context = (approval as Record<string, unknown>)["context"];
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const sessionId = (context as Record<string, unknown>)["session_id"];
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

export function readApprovalThreadId(payload: Record<string, unknown> | null): string | null {
  const approval = payload?.["approval"];
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return null;
  const context = (approval as Record<string, unknown>)["context"];
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const threadId = (context as Record<string, unknown>)["thread_id"];
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId : null;
}

function readApprovalRequestContext(
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const context = payload?.["context"];
  return context && typeof context === "object" && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : null;
}

export function readApprovalRequestSessionId(
  payload: Record<string, unknown> | null,
): string | null {
  const context = readApprovalRequestContext(payload);
  const sessionId = context?.["session_id"];
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

export function readApprovalRequestThreadId(
  payload: Record<string, unknown> | null,
): string | null {
  const context = readApprovalRequestContext(payload);
  const threadId = context?.["thread_id"];
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId : null;
}

export function toApprovalTranscriptItem(
  payload: Record<string, unknown> | null,
  occurredAt: string,
): SessionTranscriptApprovalItem | null {
  const approval = payload?.["approval"];
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) return null;
  const record = approval as Record<string, unknown>;
  const approvalId = typeof record["approval_id"] === "string" ? record["approval_id"].trim() : "";
  const status = typeof record["status"] === "string" ? record["status"].trim() : "";
  const prompt = typeof record["prompt"] === "string" ? record["prompt"] : "";
  if (!approvalId || !status || !prompt) return null;
  const context =
    typeof record["context"] === "object" &&
    record["context"] !== null &&
    !Array.isArray(record["context"])
      ? (record["context"] as Record<string, unknown>)
      : null;
  const scope =
    typeof record["scope"] === "object" &&
    record["scope"] !== null &&
    !Array.isArray(record["scope"])
      ? (record["scope"] as Record<string, unknown>)
      : null;
  return {
    kind: "approval",
    id: approvalId,
    approval_id: approvalId,
    status: status as SessionTranscriptApprovalItem["status"],
    title: "Approval required",
    detail: prompt,
    created_at:
      typeof record["created_at"] === "string" && record["created_at"].trim().length > 0
        ? record["created_at"]
        : occurredAt,
    updated_at: occurredAt,
    ...(typeof context?.["tool_call_id"] === "string" && context["tool_call_id"].trim().length > 0
      ? { tool_call_id: context["tool_call_id"] as string }
      : {}),
    ...(typeof scope?.["run_id"] === "string" ? { run_id: scope["run_id"] as string } : {}),
  };
}

export function toApprovalRequestTranscriptItem(
  payload: Record<string, unknown> | null,
  occurredAt: string,
): SessionTranscriptApprovalItem | null {
  if (!payload) return null;
  const approvalId =
    typeof payload["approval_id"] === "string" ? payload["approval_id"].trim() : "";
  const prompt = typeof payload["prompt"] === "string" ? payload["prompt"] : "";
  const context = readApprovalRequestContext(payload);
  if (!approvalId || !prompt) return null;
  return {
    kind: "approval",
    id: approvalId,
    approval_id: approvalId,
    status: "pending",
    title: "Approval required",
    detail: prompt,
    created_at: occurredAt,
    updated_at: occurredAt,
    ...(typeof context?.["tool_call_id"] === "string" && context["tool_call_id"].trim().length > 0
      ? { tool_call_id: context["tool_call_id"] as string }
      : {}),
  };
}

export function toToolTranscriptItem(
  payload: Record<string, unknown> | null,
  occurredAt: string,
): SessionTranscriptToolItem | null {
  if (!payload) return null;
  const toolCallId =
    typeof payload["tool_call_id"] === "string" ? payload["tool_call_id"].trim() : "";
  const toolId = typeof payload["tool_id"] === "string" ? payload["tool_id"].trim() : "";
  const status = typeof payload["status"] === "string" ? payload["status"].trim() : "";
  if (!toolCallId || !toolId || !status) return null;
  return {
    kind: "tool",
    id: toolCallId,
    tool_id: toolId,
    tool_call_id: toolCallId,
    status: status as SessionTranscriptToolItem["status"],
    summary: typeof payload["summary"] === "string" ? payload["summary"] : "",
    created_at: occurredAt,
    updated_at: occurredAt,
    ...(typeof payload["duration_ms"] === "number" ? { duration_ms: payload["duration_ms"] } : {}),
    ...(typeof payload["error"] === "string" && payload["error"].trim().length > 0
      ? { error: payload["error"] }
      : {}),
    ...(typeof payload["run_id"] === "string" ? { run_id: payload["run_id"] } : {}),
    ...(typeof payload["agent_id"] === "string" ? { agent_id: payload["agent_id"] } : {}),
    ...(typeof payload["workspace_id"] === "string"
      ? { workspace_id: payload["workspace_id"] }
      : {}),
    ...(typeof payload["channel"] === "string" ? { channel: payload["channel"] } : {}),
    ...(typeof payload["thread_id"] === "string" ? { thread_id: payload["thread_id"] } : {}),
  };
}

export function toReasoningTranscriptItem(
  payload: Record<string, unknown> | null,
  occurredAt: string,
): ChatReasoningTranscriptItem | null {
  if (!payload) return null;
  const reasoningId =
    typeof payload["reasoning_id"] === "string" ? payload["reasoning_id"].trim() : "";
  if (!reasoningId) return null;
  const content =
    typeof payload["content"] === "string"
      ? payload["content"]
      : typeof payload["delta"] === "string"
        ? payload["delta"]
        : "";
  return {
    kind: "reasoning",
    id: reasoningId,
    content,
    created_at: occurredAt,
    updated_at: occurredAt,
  };
}
