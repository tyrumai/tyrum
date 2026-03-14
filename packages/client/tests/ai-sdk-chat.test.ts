import { describe, expect, it } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  createTyrumAiSdkChatTransport,
  type TyrumAiSdkChatSocket,
  type TyrumClientDynamicSchema,
} from "../src/index.js";

class FakeAiSdkChatSocket implements TyrumAiSdkChatSocket {
  public connected = true;
  public lastRequest: { payload: unknown; type: string } | null = null;
  public nextResult: unknown = undefined;
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>();

  async requestDynamic<T>(
    type: string,
    payload: unknown,
    schema?: TyrumClientDynamicSchema<T>,
  ): Promise<T> {
    this.lastRequest = { payload, type };
    const result = this.nextResult;
    if (!schema) {
      return result as T;
    }
    const parsed = schema.safeParse(result);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    return parsed.data;
  }

  onDynamicEvent(event: string, handler: (event: unknown) => void): void {
    const set = this.handlers.get(event) ?? new Set<(event: unknown) => void>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  offDynamicEvent(event: string, handler: (event: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

const TEST_AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";

async function readStream(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return chunks;
    }
    chunks.push(result.value);
  }
}

describe("AI SDK chat transport", () => {
  it("turns WS stream events into a UIMessageChunk stream", async () => {
    const socket = new FakeAiSdkChatSocket();
    socket.nextResult = { stream_id: "stream-1" };
    const transport = createTyrumAiSdkChatTransport({ client: socket });

    const stream = await transport.sendMessages({
      abortSignal: undefined,
      chatId: "session-1",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
    });
    const chunksPromise = readStream(stream);
    await new Promise((resolve) => setTimeout(resolve, 0));

    socket.emit("chat.ui-message.stream", {
      event_id: "event-ignore",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        chunk: { id: "ignore-me", type: "text-start" },
        stage: "chunk",
        stream_id: "other-stream",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });
    socket.emit("chat.ui-message.stream", {
      event_id: "event-1",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        chunk: { id: "text-1", type: "text-start" },
        stage: "chunk",
        stream_id: "stream-1",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });
    socket.emit("chat.ui-message.stream", {
      event_id: "event-2",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        chunk: { delta: "hello", id: "text-1", type: "text-delta" },
        stage: "chunk",
        stream_id: "stream-1",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });
    socket.emit("chat.ui-message.stream", {
      event_id: "event-3",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        chunk: { id: "text-1", type: "text-end" },
        stage: "chunk",
        stream_id: "stream-1",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });
    socket.emit("chat.ui-message.stream", {
      event_id: "event-4",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        stage: "done",
        stream_id: "stream-1",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });

    const chunks = await chunksPromise;

    expect(socket.lastRequest).toEqual({
      payload: {
        body: undefined,
        headers: undefined,
        message_id: undefined,
        messages: undefined,
        metadata: undefined,
        session_id: "session-1",
        trigger: "submit-message",
      },
      type: "chat.session.send",
    });
    expect(chunks).toEqual([
      { id: "text-1", type: "text-start" },
      { delta: "hello", id: "text-1", type: "text-delta" },
      { id: "text-1", type: "text-end" },
    ]);
  });

  it("returns null when no resumable stream exists", async () => {
    const socket = new FakeAiSdkChatSocket();
    socket.nextResult = null;
    const transport = createTyrumAiSdkChatTransport({ client: socket });

    const stream = await transport.reconnectToStream({ chatId: "session-1" });

    expect(stream).toBeNull();
    expect(socket.lastRequest?.type).toBe("chat.session.reconnect");
  });

  it("submits only the latest user message to the server", async () => {
    const socket = new FakeAiSdkChatSocket();
    socket.nextResult = { stream_id: "stream-2" };
    const transport = createTyrumAiSdkChatTransport({ client: socket });
    const messages: UIMessage[] = [
      {
        id: "m-1",
        role: "user",
        parts: [{ type: "text", text: "Earlier" }],
      },
      {
        id: "m-2",
        role: "assistant",
        parts: [{ type: "text", text: "Reply" }],
      },
      {
        id: "m-3",
        role: "user",
        parts: [{ type: "text", text: "Latest" }],
      },
    ];

    await transport.sendMessages({
      abortSignal: undefined,
      chatId: "session-1",
      messageId: "m-3",
      messages,
      trigger: "submit-message",
    });

    expect(socket.lastRequest).toEqual({
      payload: {
        body: undefined,
        headers: undefined,
        message_id: "m-3",
        messages: [messages[2]],
        metadata: undefined,
        session_id: "session-1",
        trigger: "submit-message",
      },
      type: "chat.session.send",
    });
  });
});
