import type { OperatorWsClient } from "../deps.js";
import { readPayload } from "../operator-core.event-helpers.js";
import type { ChatReasoningTranscriptItem, ChatState } from "./chat-store.types.js";
import {
  activeToolCallIdsForSession,
  appendTranscriptReasoningDelta,
  appendTranscriptTextDelta,
  eventOccurredAt,
  readApprovalSessionId,
  readApprovalThreadId,
  toApprovalTranscriptItem,
  toReasoningTranscriptItem,
  toToolTranscriptItem,
  appendTranscriptTextItem,
  upsertTranscriptItem,
} from "./chat-store.transcript.js";

type ChatStateSetter = (updater: (prev: ChatState) => ChatState) => void;

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

function handleTypingState(setState: ChatStateSetter, data: unknown, typing: boolean): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  setState((prev) =>
    !matchesActiveSession(prev, { sessionId, threadId })
      ? prev
      : { ...prev, active: { ...prev.active, typing } },
  );
}

function handleSessionSendFailed(setState: ChatStateSetter, data: unknown): void {
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
  setState((prev) => {
    const session = prev.active.session;
    if (!session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    const transcript = session.transcript.filter((item) => !removedIds.has(item.id));
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

function handleApprovalEvent(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = readApprovalSessionId(payload);
  const threadId = readApprovalThreadId(payload);
  const item = toApprovalTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  setState((prev) => {
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

function handleToolLifecycle(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const item = toToolTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  setState((prev) => {
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

function handleMessageDelta(setState: ChatStateSetter, data: unknown): void {
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
  setState((prev) => {
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

function handleMessageFinal(setState: ChatStateSetter, data: unknown): void {
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
  setState((prev) => {
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

function handleReasoningDelta(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const reasoningId =
    typeof payload?.["reasoning_id"] === "string" ? payload["reasoning_id"] : null;
  const delta = typeof payload?.["delta"] === "string" ? payload["delta"] : null;
  if (!reasoningId || delta === null) return;
  setState((prev) => {
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

function handleReasoningFinal(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  const threadId = typeof payload?.["thread_id"] === "string" ? payload["thread_id"] : null;
  const occurredAt = eventOccurredAt(data);
  const item = toReasoningTranscriptItem(payload, occurredAt);
  if (!item) return;
  setState((prev) => {
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

export function registerChatStoreEventHandlers(
  ws: OperatorWsClient,
  setState: ChatStateSetter,
): void {
  ws.on?.("typing.started", (data) => {
    handleTypingState(setState, data, true);
  });
  ws.on?.("typing.stopped", (data) => {
    handleTypingState(setState, data, false);
  });
  ws.on?.("approval.requested", (data) => {
    handleApprovalEvent(setState, data);
  });
  ws.on?.("approval.resolved", (data) => {
    handleApprovalEvent(setState, data);
  });
  ws.on?.("tool.lifecycle" as never, (data) => {
    handleToolLifecycle(setState, data);
  });
  ws.on?.("message.delta", (data) => {
    handleMessageDelta(setState, data);
  });
  ws.on?.("message.final", (data) => {
    handleMessageFinal(setState, data);
  });
  ws.on?.("reasoning.delta" as never, (data) => {
    handleReasoningDelta(setState, data);
  });
  ws.on?.("reasoning.final" as never, (data) => {
    handleReasoningFinal(setState, data);
  });
  ws.on?.("session.send.failed" as never, (data) => {
    handleSessionSendFailed(setState, data);
  });
}
