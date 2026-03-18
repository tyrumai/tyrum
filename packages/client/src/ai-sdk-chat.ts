import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  WsAiSdkChatStreamEvent,
  WsAiSdkChatStreamEventPayload,
  WsChatSessionArchiveResult,
  WsChatSessionCreateResult,
  WsChatSessionDeleteResult,
  WsChatSessionGetResult,
  WsChatSessionListResult,
  WsChatSessionReconnectResult,
  WsChatSessionStreamStart,
  type WsChatSession as WsChatSessionT,
  type WsChatSessionArchivePayload,
  type WsChatSessionCreatePayload,
  type WsChatSessionDeletePayload,
  type WsChatSessionGetPayload,
  type WsChatSessionListPayload,
  type WsChatSessionPreview,
  type WsChatSessionReconnectPayload,
  type WsChatSessionSendPayload as WsChatSessionSendPayloadT,
  type WsChatSessionSendTrigger,
  type WsChatSessionSummary,
} from "@tyrum/schemas";
import type { TyrumClientDynamicSchema } from "./ws-client.js";

export interface TyrumAiSdkChatSocket {
  connected: boolean;
  requestDynamic<T = unknown>(
    type: string,
    payload: unknown,
    schema?: TyrumClientDynamicSchema<T>,
    timeoutMs?: number,
  ): Promise<T>;
  onDynamicEvent(event: string, handler: (event: unknown) => void): void;
  offDynamicEvent(event: string, handler: (event: unknown) => void): void;
}

export type TyrumAiSdkChatTrigger = WsChatSessionSendTrigger;

export type TyrumAiSdkChatOperations = {
  sessionArchive: string;
  sessionCreate: string;
  sessionDelete: string;
  sessionGet: string;
  sessionList: string;
  sessionReconnect: string;
  sessionSend: string;
  streamEvent: string;
};

export const DEFAULT_TYRUM_AI_SDK_CHAT_OPERATIONS: TyrumAiSdkChatOperations = {
  sessionArchive: "chat.session.archive",
  sessionCreate: "chat.session.create",
  sessionDelete: "chat.session.delete",
  sessionGet: "chat.session.get",
  sessionList: "chat.session.list",
  sessionReconnect: "chat.session.reconnect",
  sessionSend: "chat.session.send",
  streamEvent: "chat.ui-message.stream",
};

export type TyrumAiSdkChatPreview = WsChatSessionPreview;

export type TyrumAiSdkChatSessionSummary = WsChatSessionSummary;

export type TyrumAiSdkChatSession<UI_MESSAGE extends UIMessage = UIMessage> = Omit<
  WsChatSessionT,
  "messages"
> & {
  messages: UI_MESSAGE[];
};

export type TyrumAiSdkChatSessionListPayload = WsChatSessionListPayload;

export type TyrumAiSdkChatSessionGetPayload = WsChatSessionGetPayload;

export type TyrumAiSdkChatSessionCreatePayload = WsChatSessionCreatePayload;

export type TyrumAiSdkChatSessionDeletePayload = WsChatSessionDeletePayload;

export type TyrumAiSdkChatStreamEvent = WsAiSdkChatStreamEventPayload;

export type TyrumAiSdkChatSendPayload<UI_MESSAGE extends UIMessage = UIMessage> = Omit<
  WsChatSessionSendPayloadT,
  "messages"
> & {
  messages?: UI_MESSAGE[];
};

export type TyrumAiSdkChatSessionArchivePayload = WsChatSessionArchivePayload;

export type TyrumAiSdkChatReconnectPayload = WsChatSessionReconnectPayload;

export type TyrumAiSdkChatStreamStart = WsChatSessionStreamStart;

export interface TyrumAiSdkChatSessionClient<UI_MESSAGE extends UIMessage = UIMessage> {
  archive(
    payload: TyrumAiSdkChatSessionArchivePayload,
  ): Promise<{ session_id: string; archived: boolean }>;
  create(payload?: TyrumAiSdkChatSessionCreatePayload): Promise<TyrumAiSdkChatSession<UI_MESSAGE>>;
  delete(payload: TyrumAiSdkChatSessionDeletePayload): Promise<{ session_id: string }>;
  get(payload: TyrumAiSdkChatSessionGetPayload): Promise<TyrumAiSdkChatSession<UI_MESSAGE>>;
  list(
    payload?: TyrumAiSdkChatSessionListPayload,
  ): Promise<{ next_cursor?: string | null; sessions: TyrumAiSdkChatSessionSummary[] }>;
}

export interface TyrumAiSdkChatTransportOptions {
  client: TyrumAiSdkChatSocket;
  operations?: Partial<TyrumAiSdkChatOperations>;
  requestTimeoutMs?: number;
}

function mergeOperations(
  operations: Partial<TyrumAiSdkChatOperations> | undefined,
): TyrumAiSdkChatOperations {
  return {
    ...DEFAULT_TYRUM_AI_SDK_CHAT_OPERATIONS,
    ...operations,
  };
}

function createListResultSchema(): TyrumClientDynamicSchema<{
  next_cursor?: string | null;
  sessions: TyrumAiSdkChatSessionSummary[];
}> {
  return WsChatSessionListResult as TyrumClientDynamicSchema<{
    next_cursor?: string | null;
    sessions: TyrumAiSdkChatSessionSummary[];
  }>;
}

function createGetResultSchema<UI_MESSAGE extends UIMessage>(): TyrumClientDynamicSchema<{
  session: TyrumAiSdkChatSession<UI_MESSAGE>;
}> {
  return WsChatSessionGetResult as TyrumClientDynamicSchema<{
    session: TyrumAiSdkChatSession<UI_MESSAGE>;
  }>;
}

function createCreateResultSchema<UI_MESSAGE extends UIMessage>(): TyrumClientDynamicSchema<{
  session: TyrumAiSdkChatSession<UI_MESSAGE>;
}> {
  return WsChatSessionCreateResult as TyrumClientDynamicSchema<{
    session: TyrumAiSdkChatSession<UI_MESSAGE>;
  }>;
}

function createArchiveResultSchema(): TyrumClientDynamicSchema<{
  session_id: string;
  archived: boolean;
}> {
  return WsChatSessionArchiveResult as TyrumClientDynamicSchema<{
    session_id: string;
    archived: boolean;
  }>;
}

function createDeleteResultSchema(): TyrumClientDynamicSchema<{ session_id: string }> {
  return WsChatSessionDeleteResult as TyrumClientDynamicSchema<{ session_id: string }>;
}

function createStreamStartSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart> {
  return WsChatSessionStreamStart as TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart>;
}

function createReconnectResultSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart | null> {
  return WsChatSessionReconnectResult as TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart | null>;
}

function createStreamEventSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatStreamEvent> {
  return {
    safeParse(input: unknown) {
      const payloadParsed = WsAiSdkChatStreamEventPayload.safeParse(input);
      if (payloadParsed.success) {
        return payloadParsed;
      }
      const envelopeParsed = WsAiSdkChatStreamEvent.safeParse(input);
      if (envelopeParsed.success) {
        return { success: true, data: envelopeParsed.data.payload };
      }
      return payloadParsed;
    },
  };
}

function selectOutboundMessages<UI_MESSAGE extends UIMessage>(
  messages: UI_MESSAGE[],
  trigger: TyrumAiSdkChatTrigger,
): UI_MESSAGE[] | undefined {
  if (trigger === "submit-message") {
    const lastMessage = messages.at(-1);
    return lastMessage ? [lastMessage] : undefined;
  }
  return undefined;
}

function toRecordHeaders(
  headers: ChatRequestOptions["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function toRecordBody(body: ChatRequestOptions["body"]): Record<string, unknown> | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  return { ...body };
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The chat request was aborted.", "AbortError");
  }
  return new Error("The chat request was aborted.");
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

function assertAbortSignal(signal: AbortSignal | undefined): void {
  if (isAbortSignalAborted(signal)) {
    throw createAbortError();
  }
}

export function supportsTyrumAiSdkChatSocket(value: unknown): value is TyrumAiSdkChatSocket {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<TyrumAiSdkChatSocket>;
  return (
    typeof candidate.requestDynamic === "function" &&
    typeof candidate.onDynamicEvent === "function" &&
    typeof candidate.offDynamicEvent === "function" &&
    typeof candidate.connected === "boolean"
  );
}

export function createTyrumAiSdkChatSessionClient<UI_MESSAGE extends UIMessage = UIMessage>({
  client,
  operations,
  requestTimeoutMs,
}: TyrumAiSdkChatTransportOptions): TyrumAiSdkChatSessionClient<UI_MESSAGE> {
  const resolvedOperations = mergeOperations(operations);
  return {
    async archive(payload) {
      return await client.requestDynamic(
        resolvedOperations.sessionArchive,
        payload,
        createArchiveResultSchema(),
        requestTimeoutMs,
      );
    },
    async list(payload = {}) {
      return await client.requestDynamic(
        resolvedOperations.sessionList,
        payload,
        createListResultSchema(),
        requestTimeoutMs,
      );
    },
    async get(payload) {
      const result = await client.requestDynamic(
        resolvedOperations.sessionGet,
        payload,
        createGetResultSchema<UI_MESSAGE>(),
        requestTimeoutMs,
      );
      return result.session;
    },
    async create(payload = {}) {
      const result = await client.requestDynamic(
        resolvedOperations.sessionCreate,
        payload,
        createCreateResultSchema<UI_MESSAGE>(),
        requestTimeoutMs,
      );
      return result.session;
    },
    async delete(payload) {
      return await client.requestDynamic(
        resolvedOperations.sessionDelete,
        payload,
        createDeleteResultSchema(),
        requestTimeoutMs,
      );
    },
  };
}

export class TyrumAiSdkChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  private readonly client: TyrumAiSdkChatSocket;
  private readonly operations: TyrumAiSdkChatOperations;
  private readonly requestTimeoutMs: number | undefined;

  public constructor({ client, operations, requestTimeoutMs }: TyrumAiSdkChatTransportOptions) {
    this.client = client;
    this.operations = mergeOperations(operations);
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public async sendMessages({
    abortSignal,
    body,
    chatId,
    headers,
    messageId,
    messages,
    metadata,
    trigger,
  }: {
    abortSignal: AbortSignal | undefined;
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    trigger: TyrumAiSdkChatTrigger;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    assertAbortSignal(abortSignal);
    const payload: TyrumAiSdkChatSendPayload<UI_MESSAGE> = {
      session_id: chatId,
      message_id: messageId,
      messages: selectOutboundMessages(messages, trigger),
      trigger,
      headers: toRecordHeaders(headers),
      body: toRecordBody(body),
      metadata,
    };
    const result = await this.client.requestDynamic(
      this.operations.sessionSend,
      payload,
      createStreamStartSchema(),
      this.requestTimeoutMs,
    );
    assertAbortSignal(abortSignal);
    return this.createStream(result.stream_id, abortSignal);
  }

  public async reconnectToStream({
    body,
    chatId,
    headers,
    metadata,
  }: {
    chatId: string;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
    const payload: TyrumAiSdkChatReconnectPayload = {
      session_id: chatId,
      headers: toRecordHeaders(headers),
      body: toRecordBody(body),
      metadata,
    };
    const result = await this.client.requestDynamic(
      this.operations.sessionReconnect,
      payload,
      createReconnectResultSchema(),
      this.requestTimeoutMs,
    );
    return result ? this.createStream(result.stream_id) : null;
  }

  private createStream(
    streamId: string,
    abortSignal?: AbortSignal,
  ): ReadableStream<UIMessageChunk> {
    const eventSchema = createStreamEventSchema();
    const eventType = this.operations.streamEvent;
    let cleanup = () => undefined;

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let settled = false;
        cleanup = () => {
          if (settled) {
            return;
          }
          settled = true;
          this.client.offDynamicEvent(eventType, handleEvent);
          abortSignal?.removeEventListener("abort", handleAbort);
        };
        const handleAbort = () => {
          cleanup();
          controller.error(createAbortError());
        };
        const handleEvent = (event: unknown) => {
          const parsed = eventSchema.safeParse(event);
          if (!parsed.success || parsed.data.stream_id !== streamId) {
            return;
          }
          if (parsed.data.stage === "chunk") {
            controller.enqueue(parsed.data.chunk as UIMessageChunk);
            return;
          }
          cleanup();
          if (parsed.data.stage === "done") {
            controller.close();
            return;
          }
          controller.error(new Error(parsed.data.error.message));
        };

        this.client.onDynamicEvent(eventType, handleEvent);
        if (abortSignal) {
          abortSignal.addEventListener("abort", handleAbort, { once: true });
          assertAbortSignal(abortSignal);
        }
      },
      cancel: () => {
        cleanup();
      },
    });
  }
}

export function createTyrumAiSdkChatTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  options: TyrumAiSdkChatTransportOptions,
): TyrumAiSdkChatTransport<UI_MESSAGE> {
  return new TyrumAiSdkChatTransport(options);
}
