import type { TyrumClientEvents } from "@tyrum/transport-sdk/browser";
import type { OperatorWsClient } from "./deps.js";
import { readOccurredAt, readPayload } from "./operator-core.event-helpers.js";
import type { Unsubscribe } from "./store.js";

type ActivityWsBindings = {
  handleTypingStarted(input: {
    conversationId?: string | null;
    threadId?: string | null;
    occurredAt?: string | null;
  }): void;
  handleTypingStopped(input: {
    conversationId?: string | null;
    threadId?: string | null;
    occurredAt?: string | null;
  }): void;
  handleMessageDelta(input: {
    conversationId: string;
    threadId?: string | null;
    messageId: string;
    role: "assistant" | "system" | "user";
    delta: string;
    occurredAt?: string | null;
  }): void;
  handleMessageFinal(input: {
    conversationId: string;
    threadId?: string | null;
    messageId: string;
    role: "assistant" | "system" | "user";
    content: string;
    occurredAt?: string | null;
  }): void;
  handleDeliveryReceipt(input: {
    conversationId: string;
    channel: string;
    threadId: string;
    status?: "sent" | "failed" | null;
    errorMessage?: string | null;
    occurredAt?: string | null;
  }): void;
};

function readMessageRole(value: unknown): "assistant" | "system" | "user" | null {
  return value === "assistant" || value === "system" || value === "user" ? value : null;
}

function readOptionalStringField(
  payload: Record<string, unknown> | null | undefined,
  field: string,
): string | null {
  const value = payload?.[field];
  return typeof value === "string" ? value : null;
}

function on(
  ws: OperatorWsClient,
  unsubscribes: Unsubscribe[],
  event: keyof TyrumClientEvents,
  handler: (data: unknown) => void,
): void {
  ws.on(event, handler);
  unsubscribes.push(() => {
    ws.off(event, handler);
  });
}

export function registerActivityWsHandlers(
  ws: OperatorWsClient,
  activity: ActivityWsBindings,
  unsubscribes: Unsubscribe[],
): void {
  on(ws, unsubscribes, "typing.started", (data) => {
    const payload = readPayload(data);
    const conversationId = readOptionalStringField(payload, "conversation_id");
    const threadId = readOptionalStringField(payload, "thread_id");
    if (!conversationId && !threadId) return;
    activity.handleTypingStarted({
      conversationId,
      threadId,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "typing.stopped", (data) => {
    const payload = readPayload(data);
    const conversationId = readOptionalStringField(payload, "conversation_id");
    const threadId = readOptionalStringField(payload, "thread_id");
    if (!conversationId && !threadId) return;
    activity.handleTypingStopped({
      conversationId,
      threadId,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "message.delta", (data) => {
    const payload = readPayload(data);
    const conversationId = readOptionalStringField(payload, "conversation_id");
    const threadId = readOptionalStringField(payload, "thread_id");
    const messageId = payload?.["message_id"];
    const role = readMessageRole(payload?.["role"]);
    const delta = payload?.["delta"];
    if (
      typeof conversationId !== "string" ||
      typeof messageId !== "string" ||
      role === null ||
      typeof delta !== "string"
    ) {
      return;
    }
    activity.handleMessageDelta({
      conversationId,
      threadId,
      messageId,
      role,
      delta,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "message.final", (data) => {
    const payload = readPayload(data);
    const conversationId = readOptionalStringField(payload, "conversation_id");
    const threadId = readOptionalStringField(payload, "thread_id");
    const messageId = payload?.["message_id"];
    const role = readMessageRole(payload?.["role"]);
    const content = payload?.["content"];
    if (
      typeof conversationId !== "string" ||
      typeof messageId !== "string" ||
      role === null ||
      typeof content !== "string"
    ) {
      return;
    }
    activity.handleMessageFinal({
      conversationId,
      threadId,
      messageId,
      role,
      content,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "delivery.receipt", (data) => {
    const payload = readPayload(data);
    const conversationId = readOptionalStringField(payload, "conversation_id");
    const channel = payload?.["channel"];
    const threadId = readOptionalStringField(payload, "thread_id");
    if (typeof conversationId !== "string" || typeof channel !== "string" || !threadId) {
      return;
    }
    const error = payload?.["error"];
    const errorMessage =
      typeof error === "object" &&
      error !== null &&
      !Array.isArray(error) &&
      typeof (error as Record<string, unknown>)["message"] === "string"
        ? ((error as Record<string, unknown>)["message"] as string)
        : null;

    activity.handleDeliveryReceipt({
      conversationId,
      channel,
      threadId,
      status:
        payload?.["status"] === "sent" || payload?.["status"] === "failed"
          ? (payload["status"] as "sent" | "failed")
          : null,
      errorMessage,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });
}
