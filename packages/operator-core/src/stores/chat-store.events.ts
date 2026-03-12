import type { OperatorWsClient } from "../deps.js";
import { readPayload } from "../operator-core.event-helpers.js";
import type {
  ChatReasoningTranscriptItem,
  ChatSession,
  ChatState,
  ChatStoreContext,
} from "./chat-store.types.js";
import {
  activeToolCallIdsForSession,
  appendTranscriptReasoningDelta,
  appendTranscriptTextDelta,
  appendTranscriptTextItem,
  eventOccurredAt,
  readApprovalRequestSessionId,
  readApprovalRequestThreadId,
  readApprovalSessionId,
  readApprovalThreadId,
  removeTranscriptEntriesById,
  toApprovalRequestTranscriptItem,
  toApprovalTranscriptItem,
  toReasoningTranscriptItem,
  toToolTranscriptItem,
  upsertTranscriptEntries,
  upsertTranscriptItem,
} from "./chat-store.transcript.js";

type PendingTranscriptItem = ChatSession["transcript"][number];

function findExistingTextCreatedAt(state: ChatState, messageId: string): string | null {
  const item = state.active.session?.transcript.find(
    (entry) => entry.kind === "text" && entry.id === messageId,
  );
  return item?.kind === "text" ? item.created_at : null;
}

function mergeReasoningFinal(
  state: ChatState,
  item: ChatReasoningTranscriptItem,
): ChatReasoningTranscriptItem {
  const existing = state.active.session?.transcript.find(
    (entry) => entry.kind === "reasoning" && entry.id === item.id,
  );
  if (!existing || existing.kind !== "reasoning") return item;
  return {
    ...item,
    created_at: existing.created_at,
    updated_at: existing.content === item.content ? existing.updated_at : item.updated_at,
  };
}

function matchesActiveSession(
  state: ChatState,
  input: { sessionId?: string | null; threadId?: string | null },
): boolean {
  if (!state.active.session) return false;
  if (input.sessionId && state.active.sessionId === input.sessionId) return true;
  if (input.threadId && state.active.session.thread_id === input.threadId) return true;
  return false;
}

function matchesPendingOpen(
  ctx: ChatStoreContext,
  input: { sessionId?: string | null; threadId?: string | null },
): boolean {
  const pending = ctx.pendingOpen;
  if (!pending) return false;
  if (input.sessionId && pending.sessionId === input.sessionId) return true;
  if (input.threadId && pending.threadId === input.threadId) return true;
  return false;
}

function updatePendingTyping(
  ctx: ChatStoreContext,
  input: { sessionId?: string | null; threadId?: string | null; typing: boolean },
): boolean {
  if (!matchesPendingOpen(ctx, input)) return false;
  if (!ctx.pendingOpen) return false;
  ctx.pendingOpen.typing = input.typing;
  return true;
}

function upsertPendingTranscriptItem(
  ctx: ChatStoreContext,
  input: { sessionId?: string | null; threadId?: string | null; item: PendingTranscriptItem },
): boolean {
  if (!matchesPendingOpen(ctx, input)) return false;
  if (!ctx.pendingOpen) return false;
  ctx.pendingOpen.transcript = upsertTranscriptEntries(ctx.pendingOpen.transcript, input.item);
  return true;
}

function removePendingTranscriptEntries(
  ctx: ChatStoreContext,
  input: { sessionId?: string | null; threadId?: string | null; removedIds: ReadonlySet<string> },
): boolean {
  if (!matchesPendingOpen(ctx, input)) return false;
  if (!ctx.pendingOpen) return false;
  ctx.pendingOpen.transcript = removeTranscriptEntriesById(
    ctx.pendingOpen.transcript,
    input.removedIds,
  );
  return true;
}

function handleTypingState(ctx: ChatStoreContext, typing: boolean, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  if (updatePendingTyping(ctx, { sessionId, threadId, typing })) return;

  ctx.setState((prev) =>
    !matchesActiveSession(prev, { sessionId, threadId })
      ? prev
      : { ...prev, active: { ...prev.active, typing } },
  );
}

function handleSessionSendFailed(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const userMessageId =
    typeof payload?.["user_message_id"] === "string" ? payload["user_message_id"] : null;
  const messageIds = Array.isArray(payload?.["message_ids"])
    ? payload["message_ids"].filter((value): value is string => typeof value === "string")
    : [];
  const reasoningIds = Array.isArray(payload?.["reasoning_ids"])
    ? payload["reasoning_ids"].filter((value): value is string => typeof value === "string")
    : [];
  if (!userMessageId && messageIds.length === 0 && reasoningIds.length === 0) return;

  const removedIds = new Set([
    ...messageIds,
    ...reasoningIds,
    ...(userMessageId ? [userMessageId] : []),
  ]);
  if (removePendingTranscriptEntries(ctx, { sessionId, threadId, removedIds })) return;

  ctx.setState((prev) => {
    const session = prev.active.session;
    if (!session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    const transcript = removeTranscriptEntriesById(session.transcript, removedIds);
    if (transcript.length === session.transcript.length) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: {
          ...session,
          transcript,
        },
      },
    };
  });
}

function handleApprovalEvent(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = readApprovalSessionId(payload);
  const threadId = readApprovalThreadId(payload);
  const item = toApprovalTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  if (upsertPendingTranscriptItem(ctx, { sessionId, threadId, item })) return;

  ctx.setState((prev) => {
    const activeSession = prev.active.session;
    if (!activeSession || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: upsertTranscriptItem(activeSession, item),
      },
    };
  });
}

function handleApprovalRequest(ctx: ChatStoreContext, data: unknown): void {
  const occurredAt = eventOccurredAt(data);
  const payload = readPayload(data);
  const item = toApprovalRequestTranscriptItem(payload, occurredAt);
  if (!item) return;
  const sessionId = readApprovalRequestSessionId(payload);
  const threadId = readApprovalRequestThreadId(payload);
  if (upsertPendingTranscriptItem(ctx, { sessionId, threadId, item })) return;

  ctx.setState((prev) => {
    const activeSession = prev.active.session;
    if (!activeSession || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: upsertTranscriptItem(activeSession, item),
      },
    };
  });
}

function handleToolLifecycle(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const item = toToolTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  if (upsertPendingTranscriptItem(ctx, { sessionId, threadId, item })) return;

  ctx.setState((prev) => {
    const activeSession = prev.active.session;
    if (!activeSession || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    const session = upsertTranscriptItem(activeSession, item);
    return {
      ...prev,
      active: {
        ...prev.active,
        session,
        activeToolCallIds: activeToolCallIdsForSession(session),
      },
    };
  });
}

function handleMessageDelta(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const messageId = typeof payload?.["message_id"] === "string" ? payload["message_id"] : null;
  const role =
    payload?.["role"] === "assistant" ||
    payload?.["role"] === "system" ||
    payload?.["role"] === "user"
      ? payload["role"]
      : null;
  const delta = typeof payload?.["delta"] === "string" ? payload["delta"] : null;
  if (!messageId || !role || delta === null) return;

  if (matchesPendingOpen(ctx, { sessionId, threadId }) && ctx.pendingOpen) {
    const existing = ctx.pendingOpen.transcript.find(
      (item): item is Extract<PendingTranscriptItem, { kind: "text" }> =>
        item.kind === "text" && item.id === messageId,
    );
    ctx.pendingOpen.transcript = upsertTranscriptEntries(ctx.pendingOpen.transcript, {
      kind: "text",
      id: messageId,
      role,
      content: `${existing?.content ?? ""}${delta}`,
      created_at: existing?.created_at ?? eventOccurredAt(data),
    });
    return;
  }

  ctx.setState((prev) => {
    if (!prev.active.session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: appendTranscriptTextDelta(prev.active.session, {
          id: messageId,
          role,
          delta,
          occurredAt: eventOccurredAt(data),
        }),
      },
    };
  });
}

function handleMessageFinal(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const messageId = typeof payload?.["message_id"] === "string" ? payload["message_id"] : null;
  const role =
    payload?.["role"] === "assistant" ||
    payload?.["role"] === "system" ||
    payload?.["role"] === "user"
      ? payload["role"]
      : null;
  const content = typeof payload?.["content"] === "string" ? payload["content"] : null;
  if (!messageId || !role || content === null) return;

  if (matchesPendingOpen(ctx, { sessionId, threadId }) && ctx.pendingOpen) {
    const existing = ctx.pendingOpen.transcript.find(
      (item): item is Extract<PendingTranscriptItem, { kind: "text" }> =>
        item.kind === "text" && item.id === messageId,
    );
    ctx.pendingOpen.transcript = upsertTranscriptEntries(ctx.pendingOpen.transcript, {
      kind: "text",
      id: messageId,
      role,
      content,
      created_at: existing?.created_at ?? eventOccurredAt(data),
    });
    return;
  }

  ctx.setState((prev) => {
    if (!prev.active.session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: appendTranscriptTextItem(prev.active.session, {
          id: messageId,
          role,
          content,
          createdAt: findExistingTextCreatedAt(prev, messageId) ?? eventOccurredAt(data),
        }),
      },
    };
  });
}

function handleReasoningDelta(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const reasoningId =
    typeof payload?.["reasoning_id"] === "string" ? payload["reasoning_id"] : null;
  const delta = typeof payload?.["delta"] === "string" ? payload["delta"] : null;
  if (!reasoningId || delta === null) return;

  if (matchesPendingOpen(ctx, { sessionId, threadId }) && ctx.pendingOpen) {
    const existing = ctx.pendingOpen.transcript.find(
      (item): item is ChatReasoningTranscriptItem =>
        item.kind === "reasoning" && item.id === reasoningId,
    );
    ctx.pendingOpen.transcript = upsertTranscriptEntries(ctx.pendingOpen.transcript, {
      kind: "reasoning",
      id: reasoningId,
      content: `${existing?.content ?? ""}${delta}`,
      created_at: existing?.created_at ?? eventOccurredAt(data),
      updated_at: eventOccurredAt(data),
    });
    return;
  }

  ctx.setState((prev) => {
    if (!prev.active.session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: appendTranscriptReasoningDelta(prev.active.session, {
          id: reasoningId,
          delta,
          occurredAt: eventOccurredAt(data),
        }),
      },
    };
  });
}

function handleReasoningFinal(ctx: ChatStoreContext, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const occurredAt = eventOccurredAt(data);
  const item = toReasoningTranscriptItem(payload, occurredAt);
  if (!item) return;

  if (upsertPendingTranscriptItem(ctx, { sessionId, threadId, item })) return;

  ctx.setState((prev) => {
    if (!prev.active.session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: upsertTranscriptItem(prev.active.session, mergeReasoningFinal(prev, item)),
      },
    };
  });
}

export function registerChatStoreEventHandlers(ws: OperatorWsClient, ctx: ChatStoreContext): void {
  ws.on?.("typing.started", (data) => {
    handleTypingState(ctx, true, data);
  });
  ws.on?.("typing.stopped", (data) => {
    handleTypingState(ctx, false, data);
  });
  ws.on?.("approval.requested", (data) => {
    handleApprovalEvent(ctx, data);
  });
  ws.on?.("approval.resolved", (data) => {
    handleApprovalEvent(ctx, data);
  });
  ws.on?.("approval_request" as never, (data) => {
    handleApprovalRequest(ctx, data);
  });
  ws.on?.("tool.lifecycle" as never, (data) => {
    handleToolLifecycle(ctx, data);
  });
  ws.on?.("message.delta", (data) => {
    handleMessageDelta(ctx, data);
  });
  ws.on?.("message.final", (data) => {
    handleMessageFinal(ctx, data);
  });
  ws.on?.("reasoning.delta" as never, (data) => {
    handleReasoningDelta(ctx, data);
  });
  ws.on?.("reasoning.final" as never, (data) => {
    handleReasoningFinal(ctx, data);
  });
  ws.on?.("session.send.failed" as never, (data) => {
    handleSessionSendFailed(ctx, data);
  });
}
