import { describe, expect, it, vi } from "vitest";
import { registerActivityWsHandlers } from "../src/operator-core.activity-events.js";

type Handler = (data: unknown) => void;

function createWs() {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((entry) => entry !== handler),
      );
    }),
  };
}

function createActivityBindings() {
  return {
    handleTypingStarted: vi.fn(),
    handleTypingStopped: vi.fn(),
    handleMessageDelta: vi.fn(),
    handleMessageFinal: vi.fn(),
    handleDeliveryReceipt: vi.fn(),
  };
}

function emit(ws: ReturnType<typeof createWs>, event: string, data: unknown): void {
  for (const handler of ws.handlers.get(event) ?? []) {
    handler(data);
  }
}

describe("registerActivityWsHandlers", () => {
  it("routes valid websocket events into activity handlers", () => {
    const ws = createWs();
    const activity = createActivityBindings();
    const unsubscribes: Array<() => void> = [];

    registerActivityWsHandlers(ws as never, activity, unsubscribes);

    emit(ws, "typing.started", {
      occurred_at: "2026-03-09T00:00:01.000Z",
      payload: { conversation_id: "conversation-1", thread_id: "thread-1" },
    });
    emit(ws, "typing.stopped", {
      payload: { thread_id: "thread-1" },
      occurred_at: "2026-03-09T00:00:02.000Z",
    });
    emit(ws, "message.delta", {
      occurred_at: "2026-03-09T00:00:03.000Z",
      payload: {
        conversation_id: "conversation-1",
        thread_id: "thread-1",
        message_id: "message-1",
        role: "assistant",
        delta: "hel",
      },
    });
    emit(ws, "message.final", {
      payload: {
        conversation_id: "conversation-1",
        message_id: "message-1",
        role: "assistant",
        content: "hello",
      },
      occurred_at: "2026-03-09T00:00:04.000Z",
    });
    emit(ws, "delivery.receipt", {
      payload: {
        conversation_id: "conversation-1",
        channel: "slack",
        thread_id: "thread-1",
        status: "failed",
        error: { message: "delivery failed" },
      },
      occurred_at: "2026-03-09T00:00:05.000Z",
    });

    expect(activity.handleTypingStarted).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      threadId: "thread-1",
      occurredAt: "2026-03-09T00:00:01.000Z",
    });
    expect(activity.handleTypingStopped).toHaveBeenCalledWith({
      conversationId: null,
      threadId: "thread-1",
      occurredAt: "2026-03-09T00:00:02.000Z",
    });
    expect(activity.handleMessageDelta).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      threadId: "thread-1",
      messageId: "message-1",
      role: "assistant",
      delta: "hel",
      occurredAt: "2026-03-09T00:00:03.000Z",
    });
    expect(activity.handleMessageFinal).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      threadId: null,
      messageId: "message-1",
      role: "assistant",
      content: "hello",
      occurredAt: "2026-03-09T00:00:04.000Z",
    });
    expect(activity.handleDeliveryReceipt).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      channel: "slack",
      threadId: "thread-1",
      status: "failed",
      errorMessage: "delivery failed",
      occurredAt: "2026-03-09T00:00:05.000Z",
    });
    expect(unsubscribes).toHaveLength(5);
  });

  it("ignores malformed payloads", () => {
    const ws = createWs();
    const activity = createActivityBindings();
    const unsubscribes: Array<() => void> = [];

    registerActivityWsHandlers(ws as never, activity, unsubscribes);

    emit(ws, "typing.started", { payload: {} });
    emit(ws, "message.delta", {
      payload: {
        conversation_id: "conversation-1",
        message_id: "message-1",
        role: "invalid",
        delta: "ignored",
      },
    });
    emit(ws, "delivery.receipt", {
      payload: { conversation_id: "conversation-1", channel: "slack" },
    });

    expect(activity.handleTypingStarted).not.toHaveBeenCalled();
    expect(activity.handleMessageDelta).not.toHaveBeenCalled();
    expect(activity.handleDeliveryReceipt).not.toHaveBeenCalled();
  });

  it("registers unsubscribe callbacks that remove the websocket handlers", () => {
    const ws = createWs();
    const activity = createActivityBindings();
    const unsubscribes: Array<() => void> = [];

    registerActivityWsHandlers(ws as never, activity, unsubscribes);

    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }

    expect(ws.on).toHaveBeenCalledTimes(5);
    expect(ws.off).toHaveBeenCalledTimes(5);
    expect([...ws.handlers.values()].flat()).toEqual([]);
  });
});
