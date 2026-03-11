import type {
  SessionTranscriptApprovalItem,
  SessionTranscriptTextItem,
  SessionTranscriptToolItem,
} from "@tyrum/client";
import type { ChatReasoningTranscriptItem, ChatSession } from "./chat-store.types.js";

type ChatTranscriptItem = ChatSession["transcript"][number];

export function transcriptTimestamp(item: ChatTranscriptItem): string {
  return item.kind === "text" ? item.created_at : item.updated_at;
}

export function sortTranscriptItems(
  transcript: readonly ChatTranscriptItem[],
): ChatTranscriptItem[] {
  return [...transcript].toSorted((left, right) => {
    const leftAt = transcriptTimestamp(left);
    const rightAt = transcriptTimestamp(right);
    if (leftAt === rightAt) return left.id.localeCompare(right.id);
    return leftAt.localeCompare(rightAt);
  });
}

export function mergeFetchedTranscript(
  previous: readonly ChatTranscriptItem[] | undefined,
  fetched: readonly ChatTranscriptItem[],
): ChatTranscriptItem[] {
  if (!previous || previous.length === 0) return [...fetched];
  const overlay = previous.filter((item) => item.kind !== "text");
  if (overlay.length === 0) return [...fetched];
  const fetchedIds = new Set(fetched.map((item) => item.id));
  return sortTranscriptItems([...fetched, ...overlay.filter((item) => !fetchedIds.has(item.id))]);
}

export function upsertTranscriptItem(session: ChatSession, item: ChatTranscriptItem): ChatSession {
  return {
    ...session,
    transcript: sortTranscriptItems(
      session.transcript.some((entry) => entry.id === item.id)
        ? session.transcript.map((entry) => (entry.id === item.id ? item : entry))
        : [...session.transcript, item],
    ),
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
    ...(typeof scope?.["run_id"] === "string" ? { run_id: scope["run_id"] as string } : {}),
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
