import type { OperatorWsClient } from "../deps.js";
import { readPayload } from "../operator-core.event-helpers.js";
import type { ChatState } from "./chat-store.types.js";
import {
  activeToolCallIdsForSession,
  eventOccurredAt,
  readApprovalSessionId,
  toApprovalTranscriptItem,
  toToolTranscriptItem,
  upsertTranscriptItem,
} from "./chat-store.transcript.js";

type ChatStateSetter = (updater: (prev: ChatState) => ChatState) => void;

function handleTypingState(
  setState: ChatStateSetter,
  data: unknown,
  typing: boolean,
): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  if (!sessionId) return;
  setState((prev) =>
    prev.active.sessionId !== sessionId
      ? prev
      : { ...prev, active: { ...prev.active, typing } },
  );
}

function handleApprovalEvent(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = readApprovalSessionId(payload);
  if (!sessionId) return;
  const item = toApprovalTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  setState((prev) => {
    if (prev.active.sessionId !== sessionId || !prev.active.session) return prev;
    return {
      ...prev,
      active: {
        ...prev.active,
        session: upsertTranscriptItem(prev.active.session, item),
      },
    };
  });
}

function handleToolLifecycle(setState: ChatStateSetter, data: unknown): void {
  const payload = readPayload(data);
  const sessionId = typeof payload?.["session_id"] === "string" ? payload["session_id"] : null;
  if (!sessionId) return;
  const item = toToolTranscriptItem(payload, eventOccurredAt(data));
  if (!item) return;
  setState((prev) => {
    if (prev.active.sessionId !== sessionId || !prev.active.session) return prev;
    const session = upsertTranscriptItem(prev.active.session, item);
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
}
