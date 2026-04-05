import { vi } from "vitest";

export function createConversationSummary(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "conversation-root-id",
    conversation_key: "conversation-root",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root conversation",
    message_count: 2,
    updated_at: "2026-03-13T12:00:00.000Z",
    created_at: "2026-03-13T11:00:00.000Z",
    archived: false,
    latest_turn_id: null,
    latest_turn_status: null,
    has_active_turn: false,
    pending_approval_count: 0,
    ...overrides,
  };
}

export function createTranscriptListResult(overrides: Record<string, unknown> = {}) {
  return {
    conversations: [
      createConversationSummary({
        child_conversations: [
          createConversationSummary({
            conversation_id: "conversation-child-id",
            conversation_key: "conversation-child",
            thread_id: "thread-child",
            title: "Child conversation",
            parent_conversation_key: "conversation-root",
            subagent_id: "subagent-1",
            latest_turn_id: "run-1",
            latest_turn_status: "running",
            has_active_turn: true,
            pending_approval_count: 1,
          }),
        ],
      }),
    ],
    next_cursor: "cursor-1",
    ...overrides,
  };
}

export function createTranscriptGetResult(overrides: Record<string, unknown> = {}) {
  return {
    root_conversation_key: "conversation-root",
    focus_conversation_key: "conversation-child",
    conversations: [
      createConversationSummary(),
      createConversationSummary({
        conversation_id: "conversation-child-id",
        conversation_key: "conversation-child",
        thread_id: "thread-child",
        title: "Child conversation",
        parent_conversation_key: "conversation-root",
        subagent_id: "subagent-1",
      }),
    ],
    events: [
      {
        event_id: "message:conversation-child:msg-1",
        kind: "message",
        occurred_at: "2026-03-13T12:01:00.000Z",
        conversation_key: "conversation-child",
        payload: {
          message: {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "inspect transcript" }],
          },
        },
      },
    ],
    ...overrides,
  };
}

export function createDeferred<T>() {
  let resolve = (_value: T) => {
    throw new Error("deferred promise resolved before initialization");
  };
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function createFakeWs() {
  const api = {
    requestDynamic: vi.fn(
      async (
        type: string,
        payload: unknown,
        schema?: { parse?: (input: unknown) => unknown },
      ): Promise<unknown> => {
        let result: unknown;
        switch (type) {
          case "transcript.list":
            result = await api.transcriptList(payload);
            break;
          case "transcript.get":
            result = await api.transcriptGet(payload);
            break;
          default:
            throw new Error(`unsupported dynamic request: ${type}`);
        }
        return schema?.parse ? schema.parse(result) : result;
      },
    ),
    transcriptList: vi.fn(async () => createTranscriptListResult()),
    transcriptGet: vi.fn(async () => createTranscriptGetResult()),
  };
  return api;
}
