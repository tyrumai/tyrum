import type { OperatorWsClient } from "../deps.js";
import { readPayload } from "../operator-core.event-helpers.js";
import type { ChatState } from "./chat-store.types.js";
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
  if (!sessionId) return;
  setState((prev) =>
    !matchesActiveSession(prev, { sessionId, threadId })
      ? prev
      : { ...prev, active: { ...prev.active, typing } },
  );
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
          createdAt: eventOccurredAt(data),
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
  const item = toReasoningTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  setState((prev) => {
    if (!prev.active.session || !matchesActiveSession(prev, { sessionId, threadId })) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: upsertTranscriptItem(prev.active.session, item),
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
}
