type HarnessChatMessage = {
  id: string;
  role: "assistant" | "system" | "tool" | "user";
  parts: Array<{ type: string; text?: string }>;
};

type HarnessChatSession = {
  session_id: string;
  agent_id: string;
  channel: string;
  thread_id: string;
  title: string;
  message_count: number;
  last_message: { role: "assistant" | "system" | "tool" | "user"; text: string } | null;
  messages: HarnessChatMessage[];
  updated_at: string;
  created_at: string;
};

type HarnessDynamicSchema<T> = {
  parse?: (input: unknown) => T;
  safeParse?: (input: unknown) => { success: true; data: T } | { success: false; error: Error };
};

type HarnessChatSocket = {
  connected: boolean;
  requestDynamic<T = unknown>(
    type: string,
    payload: unknown,
    schema?: HarnessDynamicSchema<T>,
    timeoutMs?: number,
  ): Promise<T>;
  onDynamicEvent(event: string, handler: (event: unknown) => void): void;
  offDynamicEvent(event: string, handler: (event: unknown) => void): void;
};

type HarnessChatStreamEvent =
  | {
      stream_id: string;
      stage: "chunk";
      chunk: unknown;
    }
  | {
      stream_id: string;
      stage: "done";
    }
  | {
      stream_id: string;
      stage: "error";
      error: { message: string };
    };

function parseDynamicResult<T>(
  schema: HarnessDynamicSchema<T> | undefined,
  value: unknown,
): T | unknown {
  if (!schema) {
    return value;
  }
  if (typeof schema.parse === "function") {
    return schema.parse(value);
  }
  if (typeof schema.safeParse === "function") {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw parsed.error;
    }
    return parsed.data;
  }
  return value;
}

function createActiveSession(): HarnessChatSession {
  const assistantMarkdown = [
    "# Markdown Rendering",
    "",
    "Preflight should keep real markdown semantics inside the chat bubble:",
    "",
    "- first bullet",
    "- second bullet with `inline code` and a [docs link](https://example.com/docs)",
    "",
    "```ts",
    "const viewportWidth = 1280;",
    "```",
  ].join("\n");

  return {
    session_id: "session-1",
    agent_id: "default",
    channel: "ui",
    thread_id: "ui-thread-1",
    title: "Layout regression coverage",
    message_count: 2,
    last_message: {
      role: "assistant",
      text: "Rendered markdown with heading, list, link, and code block.",
    },
    messages: [
      {
        id: "turn-1",
        role: "user",
        parts: [{ type: "text", text: "Can we prevent page overflow regressions?" }],
      },
      {
        id: "turn-2",
        role: "assistant",
        parts: [{ type: "text", text: assistantMarkdown }],
      },
    ],
    updated_at: "2026-03-08T00:00:00.000Z",
    created_at: "2026-03-08T00:00:00.000Z",
  };
}

export function createAiSdkChatWsStub(): HarnessChatSocket {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const activeSession = createActiveSession();

  const emit = (eventType: string, payload: HarnessChatStreamEvent) => {
    const listeners = handlers.get(eventType);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(payload);
    }
  };

  return {
    connected: true,
    async requestDynamic<T>(
      type: string,
      payload: unknown,
      schema?: HarnessDynamicSchema<T>,
      _timeoutMs?: number,
    ): Promise<T> {
      switch (type) {
        case "chat.session.list":
          return parseDynamicResult(schema, {
            sessions: [
              {
                agent_id: activeSession.agent_id,
                session_id: activeSession.session_id,
                channel: activeSession.channel,
                thread_id: activeSession.thread_id,
                title: activeSession.title,
                message_count: activeSession.message_count,
                last_message: activeSession.last_message,
                created_at: activeSession.created_at,
                updated_at: activeSession.updated_at,
              },
            ],
            next_cursor: null,
          }) as T;
        case "chat.session.get":
        case "chat.session.create":
          return parseDynamicResult(schema, { session: activeSession }) as T;
        case "chat.session.delete":
          return parseDynamicResult(schema, { session_id: activeSession.session_id }) as T;
        case "chat.session.send": {
          const streamId = "layout-harness-stream";
          queueMicrotask(() => {
            emit("chat.ui-message.stream", {
              stream_id: streamId,
              stage: "done",
            });
          });
          return parseDynamicResult(schema, { stream_id: streamId }) as T;
        }
        case "chat.session.reconnect":
          return parseDynamicResult(schema, null) as T;
        default:
          throw new Error(`unsupported operation: ${type} ${JSON.stringify(payload)}`);
      }
    },
    onDynamicEvent(event: string, handler: (event: unknown) => void) {
      const next = handlers.get(event) ?? new Set();
      next.add(handler);
      handlers.set(event, next);
    },
    offDynamicEvent(event: string, handler: (event: unknown) => void) {
      const next = handlers.get(event);
      if (!next) return;
      next.delete(handler);
      if (next.size === 0) {
        handlers.delete(event);
      }
    },
  };
}
