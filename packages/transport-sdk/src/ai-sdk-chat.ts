import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from "ai";
import {
  type QueueMode as QueueModeT,
  WsAiSdkChatStreamEvent,
  WsAiSdkChatStreamEventPayload,
  WsConversationArchiveResult,
  WsConversationCreateResult,
  WsConversationDeleteResult,
  WsConversationGetResult,
  WsConversationListResult,
  WsConversationQueueModeSetResult,
  WsConversationReconnectResult,
  WsConversationStreamStart,
  type WsConversation as WsConversationT,
  type WsConversationArchiveResult as WsConversationArchiveResultT,
  type WsConversationArchivePayload,
  type WsConversationCreatePayload,
  type WsConversationDeletePayload,
  type WsConversationGetPayload,
  type WsConversationListPayload,
  type WsConversationPreview,
  type WsConversationQueueModeSetResult as WsConversationQueueModeSetResultT,
  type WsConversationQueueModeSetPayload,
  type WsConversationReconnectPayload,
  type WsConversationSendPayload as WsConversationSendPayloadT,
  type WsConversationSendTrigger,
  type WsConversationSummary,
} from "@tyrum/contracts";
import type { TyrumClientDynamicSchema } from "./ws-client.generated.js";

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

export type TyrumAiSdkChatTrigger = WsConversationSendTrigger;
export type TyrumAiSdkChatQueueMode = QueueModeT;

export type TyrumAiSdkChatOperations = {
  conversationArchive: string;
  conversationCreate: string;
  conversationDelete: string;
  conversationGet: string;
  conversationList: string;
  conversationQueueModeSet: string;
  conversationReconnect: string;
  conversationSend: string;
  streamEvent: string;
};

export const DEFAULT_TYRUM_AI_SDK_CHAT_OPERATIONS: TyrumAiSdkChatOperations = {
  conversationArchive: "conversation.archive",
  conversationCreate: "conversation.create",
  conversationDelete: "conversation.delete",
  conversationGet: "conversation.get",
  conversationList: "conversation.list",
  conversationQueueModeSet: "conversation.queue_mode.set",
  conversationReconnect: "conversation.reconnect",
  conversationSend: "conversation.send",
  streamEvent: "chat.ui-message.stream",
};

export type TyrumAiSdkChatPreview = WsConversationPreview;

export type TyrumAiSdkChatConversationSummary = WsConversationSummary;

export type TyrumAiSdkChatConversation<UI_MESSAGE extends UIMessage = UIMessage> = Omit<
  WsConversationT,
  "messages"
> & {
  messages: UI_MESSAGE[];
};

export type TyrumAiSdkChatConversationListPayload = WsConversationListPayload;
export type TyrumAiSdkChatConversationGetPayload = WsConversationGetPayload;
export type TyrumAiSdkChatConversationCreatePayload = WsConversationCreatePayload;
export type TyrumAiSdkChatConversationDeletePayload = WsConversationDeletePayload;
export type TyrumAiSdkChatConversationQueueModeSetPayload = WsConversationQueueModeSetPayload;

export type TyrumAiSdkChatStreamEvent = WsAiSdkChatStreamEventPayload;

export type TyrumAiSdkChatSendPayload<UI_MESSAGE extends UIMessage = UIMessage> = Omit<
  WsConversationSendPayloadT,
  "messages"
> & {
  messages?: UI_MESSAGE[];
};

export type TyrumAiSdkChatConversationArchivePayload = WsConversationArchivePayload;
export type TyrumAiSdkChatReconnectPayload = WsConversationReconnectPayload;

export type TyrumAiSdkChatStreamStart = WsConversationStreamStart;

export type TyrumAiSdkChatConversationQueueModeSetResult = WsConversationQueueModeSetResultT;

export interface TyrumAiSdkChatConversationClient<UI_MESSAGE extends UIMessage = UIMessage> {
  archive(payload: TyrumAiSdkChatConversationArchivePayload): Promise<WsConversationArchiveResultT>;
  create(
    payload?: TyrumAiSdkChatConversationCreatePayload,
  ): Promise<TyrumAiSdkChatConversation<UI_MESSAGE>>;
  delete(payload: TyrumAiSdkChatConversationDeletePayload): Promise<WsConversationDeletePayload>;
  get(
    payload: TyrumAiSdkChatConversationGetPayload,
  ): Promise<TyrumAiSdkChatConversation<UI_MESSAGE>>;
  list(
    payload?: TyrumAiSdkChatConversationListPayload,
  ): Promise<{ next_cursor?: string | null; conversations: TyrumAiSdkChatConversationSummary[] }>;
  setQueueMode(
    payload: TyrumAiSdkChatConversationQueueModeSetPayload,
  ): Promise<TyrumAiSdkChatConversationQueueModeSetResult>;
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

function toConversation<UI_MESSAGE extends UIMessage>(
  conversation: WsConversationT,
): TyrumAiSdkChatConversation<UI_MESSAGE> {
  const { messages, ...rest } = conversation;
  return {
    ...rest,
    messages: messages as UI_MESSAGE[],
  };
}

function createListResultSchema(): TyrumClientDynamicSchema<{
  next_cursor?: string | null;
  conversations: TyrumAiSdkChatConversationSummary[];
}> {
  return WsConversationListResult as TyrumClientDynamicSchema<{
    next_cursor?: string | null;
    conversations: TyrumAiSdkChatConversationSummary[];
  }>;
}

function createGetResultSchema<UI_MESSAGE extends UIMessage>(): TyrumClientDynamicSchema<{
  conversation: TyrumAiSdkChatConversation<UI_MESSAGE>;
}> {
  return {
    safeParse(input: unknown) {
      const parsed = WsConversationGetResult.safeParse(input);
      if (!parsed.success) {
        return parsed;
      }
      return {
        success: true,
        data: {
          conversation: toConversation<UI_MESSAGE>(parsed.data.conversation),
        },
      };
    },
  };
}

function createCreateResultSchema<UI_MESSAGE extends UIMessage>(): TyrumClientDynamicSchema<{
  conversation: TyrumAiSdkChatConversation<UI_MESSAGE>;
}> {
  return {
    safeParse(input: unknown) {
      const parsed = WsConversationCreateResult.safeParse(input);
      if (!parsed.success) {
        return parsed;
      }
      return {
        success: true,
        data: {
          conversation: toConversation<UI_MESSAGE>(parsed.data.conversation),
        },
      };
    },
  };
}

function createArchiveResultSchema(): TyrumClientDynamicSchema<WsConversationArchiveResultT> {
  return WsConversationArchiveResult as TyrumClientDynamicSchema<WsConversationArchiveResultT>;
}

function createDeleteResultSchema(): TyrumClientDynamicSchema<WsConversationDeletePayload> {
  return WsConversationDeleteResult as TyrumClientDynamicSchema<WsConversationDeletePayload>;
}

function createQueueModeSetResultSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatConversationQueueModeSetResult> {
  return WsConversationQueueModeSetResult as TyrumClientDynamicSchema<TyrumAiSdkChatConversationQueueModeSetResult>;
}

function createStreamStartSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart> {
  return WsConversationStreamStart as TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart>;
}

function createReconnectResultSchema(): TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart | null> {
  return WsConversationReconnectResult as TyrumClientDynamicSchema<TyrumAiSdkChatStreamStart | null>;
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

export function createTyrumAiSdkChatConversationClient<UI_MESSAGE extends UIMessage = UIMessage>({
  client,
  operations,
  requestTimeoutMs,
}: TyrumAiSdkChatTransportOptions): TyrumAiSdkChatConversationClient<UI_MESSAGE> {
  const resolvedOperations = mergeOperations(operations);
  return {
    async archive(payload) {
      return await client.requestDynamic(
        resolvedOperations.conversationArchive,
        payload satisfies WsConversationArchivePayload,
        createArchiveResultSchema(),
        requestTimeoutMs,
      );
    },
    async list(payload = {}) {
      return await client.requestDynamic(
        resolvedOperations.conversationList,
        payload,
        createListResultSchema(),
        requestTimeoutMs,
      );
    },
    async get(payload) {
      const result = await client.requestDynamic(
        resolvedOperations.conversationGet,
        payload satisfies WsConversationGetPayload,
        createGetResultSchema<UI_MESSAGE>(),
        requestTimeoutMs,
      );
      return result.conversation;
    },
    async create(payload = {}) {
      const result = await client.requestDynamic(
        resolvedOperations.conversationCreate,
        payload,
        createCreateResultSchema<UI_MESSAGE>(),
        requestTimeoutMs,
      );
      return result.conversation;
    },
    async delete(payload) {
      return await client.requestDynamic(
        resolvedOperations.conversationDelete,
        payload satisfies WsConversationDeletePayload,
        createDeleteResultSchema(),
        requestTimeoutMs,
      );
    },
    async setQueueMode(payload) {
      return await client.requestDynamic(
        resolvedOperations.conversationQueueModeSet,
        payload satisfies WsConversationQueueModeSetPayload,
        createQueueModeSetResultSchema(),
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
      conversation_id: chatId,
      message_id: messageId,
      messages: selectOutboundMessages(messages, trigger),
      trigger,
      headers: toRecordHeaders(headers),
      body: toRecordBody(body),
      metadata,
    };
    const result = await this.client.requestDynamic(
      this.operations.conversationSend,
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
      conversation_id: chatId,
      headers: toRecordHeaders(headers),
      body: toRecordBody(body),
      metadata,
    };
    const result = await this.client.requestDynamic(
      this.operations.conversationReconnect,
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
