import type { TyrumClientEvents } from "@tyrum/client/browser";
import type { OperatorWsClient } from "./deps.js";
import { readOccurredAt, readPayload } from "./operator-core.event-helpers.js";
import type { Unsubscribe } from "./store.js";

type ActivityWsBindings = {
  handleTypingStarted(input: {
    sessionId: string;
    lane?: string | null;
    occurredAt?: string | null;
  }): void;
  handleTypingStopped(input: {
    sessionId: string;
    lane?: string | null;
    occurredAt?: string | null;
  }): void;
  handleMessageDelta(input: {
    sessionId: string;
    lane?: string | null;
    messageId: string;
    role: "assistant" | "system" | "user";
    delta: string;
    occurredAt?: string | null;
  }): void;
  handleMessageFinal(input: {
    sessionId: string;
    lane?: string | null;
    messageId: string;
    role: "assistant" | "system" | "user";
    content: string;
    occurredAt?: string | null;
  }): void;
  handleDeliveryReceipt(input: {
    sessionId: string;
    lane?: string | null;
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
    const sessionId = payload?.["session_id"];
    if (typeof sessionId !== "string") return;
    activity.handleTypingStarted({
      sessionId,
      lane: typeof payload?.["lane"] === "string" ? (payload["lane"] as string) : null,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "typing.stopped", (data) => {
    const payload = readPayload(data);
    const sessionId = payload?.["session_id"];
    if (typeof sessionId !== "string") return;
    activity.handleTypingStopped({
      sessionId,
      lane: typeof payload?.["lane"] === "string" ? (payload["lane"] as string) : null,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "message.delta", (data) => {
    const payload = readPayload(data);
    const sessionId = payload?.["session_id"];
    const messageId = payload?.["message_id"];
    const role = readMessageRole(payload?.["role"]);
    const delta = payload?.["delta"];
    if (
      typeof sessionId !== "string" ||
      typeof messageId !== "string" ||
      role === null ||
      typeof delta !== "string"
    ) {
      return;
    }
    activity.handleMessageDelta({
      sessionId,
      lane: typeof payload?.["lane"] === "string" ? (payload["lane"] as string) : null,
      messageId,
      role,
      delta,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "message.final", (data) => {
    const payload = readPayload(data);
    const sessionId = payload?.["session_id"];
    const messageId = payload?.["message_id"];
    const role = readMessageRole(payload?.["role"]);
    const content = payload?.["content"];
    if (
      typeof sessionId !== "string" ||
      typeof messageId !== "string" ||
      role === null ||
      typeof content !== "string"
    ) {
      return;
    }
    activity.handleMessageFinal({
      sessionId,
      lane: typeof payload?.["lane"] === "string" ? (payload["lane"] as string) : null,
      messageId,
      role,
      content,
      occurredAt: readOccurredAt(data) ?? readOccurredAt(payload),
    });
  });

  on(ws, unsubscribes, "delivery.receipt", (data) => {
    const payload = readPayload(data);
    const sessionId = payload?.["session_id"];
    const channel = payload?.["channel"];
    const threadId = payload?.["thread_id"];
    if (
      typeof sessionId !== "string" ||
      typeof channel !== "string" ||
      typeof threadId !== "string"
    ) {
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
      sessionId,
      lane: typeof payload?.["lane"] === "string" ? (payload["lane"] as string) : null,
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
