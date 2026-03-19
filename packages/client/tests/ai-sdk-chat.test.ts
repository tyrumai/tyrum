import { describe, expect, it } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  createTyrumAiSdkChatSessionClient,
  createTyrumAiSdkChatTransport,
  supportsTyrumAiSdkChatSocket,
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

  it("exposes the session client helpers and socket guard", async () => {
    const socket = new FakeAiSdkChatSocket();
    const client = createTyrumAiSdkChatSessionClient({
      client: socket,
      operations: {
        sessionArchive: "chat.archive.custom",
        sessionCreate: "chat.create.custom",
        sessionDelete: "chat.delete.custom",
        sessionGet: "chat.get.custom",
        sessionList: "chat.list.custom",
      },
      requestTimeoutMs: 4321,
    });

    socket.nextResult = { archived: true, session_id: "session-1" };
    await expect(client.archive({ session_id: "session-1" })).resolves.toEqual({
      archived: true,
      session_id: "session-1",
    });
    expect(socket.lastRequest?.type).toBe("chat.archive.custom");

    socket.nextResult = { next_cursor: null, sessions: [] };
    await expect(client.list()).resolves.toEqual({ next_cursor: null, sessions: [] });
    expect(socket.lastRequest?.type).toBe("chat.list.custom");

    socket.nextResult = {
      session: {
        agent_id: "default",
        channel: "ui",
        created_at: "2026-03-13T12:00:00Z",
        last_message: null,
        message_count: 0,
        messages: [],
        session_id: "session-1",
        thread_id: "ui-session-1",
        title: "Demo",
        updated_at: "2026-03-13T12:00:00Z",
      },
    };
    await expect(client.get({ session_id: "session-1" })).resolves.toMatchObject({
      session_id: "session-1",
      title: "Demo",
    });
    expect(socket.lastRequest?.type).toBe("chat.get.custom");

    socket.nextResult = {
      session: {
        agent_id: "default",
        channel: "ui",
        created_at: "2026-03-13T12:00:00Z",
        last_message: null,
        message_count: 0,
        messages: [],
        session_id: "session-2",
        thread_id: "ui-session-2",
        title: "Created",
        updated_at: "2026-03-13T12:00:00Z",
      },
    };
    await expect(client.create()).resolves.toMatchObject({
      session_id: "session-2",
      title: "Created",
    });
    expect(socket.lastRequest?.type).toBe("chat.create.custom");

    socket.nextResult = { session_id: "session-2" };
    await expect(client.delete({ session_id: "session-2" })).resolves.toEqual({
      session_id: "session-2",
    });
    expect(socket.lastRequest?.type).toBe("chat.delete.custom");

    expect(supportsTyrumAiSdkChatSocket(socket)).toBe(true);
    expect(supportsTyrumAiSdkChatSocket(null)).toBe(false);
    expect(
      supportsTyrumAiSdkChatSocket({
        connected: true,
        offDynamicEvent() {},
        onDynamicEvent() {},
      }),
    ).toBe(false);
  });

  it("reconnects streams, unwraps envelope events, and forwards request metadata", async () => {
    const socket = new FakeAiSdkChatSocket();
    socket.nextResult = { stream_id: "stream-3" };
    const transport = createTyrumAiSdkChatTransport({
      client: socket,
      operations: {
        sessionReconnect: "chat.reconnect.custom",
        streamEvent: "chat.stream.custom",
      },
      requestTimeoutMs: 987,
    });

    const stream = await transport.reconnectToStream({
      body: { mode: "resume" },
      chatId: "session-3",
      headers: new Headers([["x-tyrum", "1"]]),
      metadata: { source: "test" },
    });

    expect(stream).not.toBeNull();
    expect(socket.lastRequest).toEqual({
      payload: {
        body: { mode: "resume" },
        headers: { "x-tyrum": "1" },
        metadata: { source: "test" },
        session_id: "session-3",
      },
      type: "chat.reconnect.custom",
    });

    const chunksPromise = readStream(stream!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    socket.emit("chat.stream.custom", {
      event_id: "event-5",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        chunk: { id: "text-9", type: "text-start" },
        stage: "chunk",
        stream_id: "stream-3",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });
    socket.emit("chat.stream.custom", {
      event_id: "event-6",
      occurred_at: "2026-03-13T12:00:00Z",
      payload: {
        stage: "done",
        stream_id: "stream-3",
      },
      scope: { agent_id: TEST_AGENT_ID, kind: "agent" },
      type: "chat.ui-message.stream",
    });

    await expect(chunksPromise).resolves.toEqual([{ id: "text-9", type: "text-start" }]);
  });

  it("aborts active streams and surfaces stream error payloads", async () => {
    const abortingSocket = new FakeAiSdkChatSocket();
    abortingSocket.nextResult = { stream_id: "stream-4" };
    const abortingTransport = createTyrumAiSdkChatTransport({ client: abortingSocket });
    const abortController = new AbortController();

    const abortingStream = await abortingTransport.sendMessages({
      abortSignal: abortController.signal,
      chatId: "session-4",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
    });
    const abortingReader = abortingStream.getReader();
    const abortRead = abortingReader.read();
    abortController.abort();

    await expect(abortRead).rejects.toMatchObject({ name: "AbortError" });

    const failingSocket = new FakeAiSdkChatSocket();
    failingSocket.nextResult = { stream_id: "stream-5" };
    const failingTransport = createTyrumAiSdkChatTransport({ client: failingSocket });
    const failingStream = await failingTransport.sendMessages({
      abortSignal: undefined,
      chatId: "session-5",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
    });
    const failingReader = failingStream.getReader();
    const failingRead = failingReader.read();

    failingSocket.emit("chat.ui-message.stream", {
      error: { message: "boom" },
      stage: "error",
      stream_id: "stream-5",
    });

    await expect(failingRead).rejects.toThrow("boom");
  });
});
