import { randomUUID } from "node:crypto";
import type { UIMessageChunk } from "ai";
import type { ConnectionManager } from "../connection-manager.js";

type AiSdkChatStreamPayload =
  | {
      stream_id: string;
      stage: "chunk";
      chunk: UIMessageChunk;
    }
  | {
      stream_id: string;
      stage: "error";
      error: { message: string };
    }
  | {
      stream_id: string;
      stage: "done";
    };

type AiSdkChatStreamEvent = {
  event_id: string;
  type: "chat.ui-message.stream";
  occurred_at: string;
  scope: { kind: "agent"; agent_id: string };
  payload: AiSdkChatStreamPayload;
};

type ActiveChatStream = {
  agentId: string;
  clientIds: Set<string>;
  conversationId: string;
  streamId: string;
  tenantId: string;
};

const activeStreamsById = new Map<string, ActiveChatStream>();
const activeStreamIdByTenantConversation = new Map<string, string>();

function keyForTenantConversation(tenantId: string, conversationId: string): string {
  return `${tenantId}:${conversationId}`;
}

function emitToClient(
  connectionManager: ConnectionManager,
  clientId: string,
  event: AiSdkChatStreamEvent,
): boolean {
  const client = connectionManager.getClient(clientId);
  if (!client || client.ws.readyState !== 1) {
    return false;
  }

  client.ws.send(JSON.stringify(event));
  return true;
}

function emitToSubscribers(
  connectionManager: ConnectionManager,
  stream: ActiveChatStream,
  payload: AiSdkChatStreamPayload,
): void {
  const event: AiSdkChatStreamEvent = {
    event_id: randomUUID(),
    type: "chat.ui-message.stream",
    occurred_at: new Date().toISOString(),
    scope: { kind: "agent", agent_id: stream.agentId },
    payload,
  };

  for (const clientId of Array.from(stream.clientIds)) {
    const delivered = emitToClient(connectionManager, clientId, event);
    if (!delivered) {
      stream.clientIds.delete(clientId);
    }
  }
}

export function createAiSdkChatStream(input: {
  agentId: string;
  clientId: string;
  conversationId: string;
  tenantId: string;
}): string {
  const streamId = randomUUID();
  const stream: ActiveChatStream = {
    agentId: input.agentId,
    clientIds: new Set([input.clientId]),
    conversationId: input.conversationId,
    streamId,
    tenantId: input.tenantId,
  };
  activeStreamsById.set(streamId, stream);
  activeStreamIdByTenantConversation.set(
    keyForTenantConversation(input.tenantId, input.conversationId),
    streamId,
  );
  return streamId;
}

export function reconnectAiSdkChatStream(input: {
  clientId: string;
  conversationId: string;
  tenantId: string;
}): string | null {
  const streamId = activeStreamIdByTenantConversation.get(
    keyForTenantConversation(input.tenantId, input.conversationId),
  );
  if (!streamId) {
    return null;
  }
  const stream = activeStreamsById.get(streamId);
  if (!stream) {
    activeStreamIdByTenantConversation.delete(
      keyForTenantConversation(input.tenantId, input.conversationId),
    );
    return null;
  }
  stream.clientIds.add(input.clientId);
  return streamId;
}

export function emitAiSdkChatChunk(input: {
  chunk: UIMessageChunk;
  connectionManager: ConnectionManager;
  streamId: string;
}): void {
  const stream = activeStreamsById.get(input.streamId);
  if (!stream) return;
  emitToSubscribers(input.connectionManager, stream, {
    stream_id: input.streamId,
    stage: "chunk",
    chunk: input.chunk,
  });
}

export function failAiSdkChatStream(input: {
  connectionManager: ConnectionManager;
  errorMessage: string;
  streamId: string;
}): void {
  const stream = activeStreamsById.get(input.streamId);
  if (!stream) return;
  emitToSubscribers(input.connectionManager, stream, {
    stream_id: input.streamId,
    stage: "error",
    error: { message: input.errorMessage },
  });
  activeStreamsById.delete(input.streamId);
  activeStreamIdByTenantConversation.delete(
    keyForTenantConversation(stream.tenantId, stream.conversationId),
  );
}

export function finishAiSdkChatStream(input: {
  connectionManager: ConnectionManager;
  streamId: string;
}): void {
  const stream = activeStreamsById.get(input.streamId);
  if (!stream) return;
  emitToSubscribers(input.connectionManager, stream, {
    stream_id: input.streamId,
    stage: "done",
  });
  activeStreamsById.delete(input.streamId);
  activeStreamIdByTenantConversation.delete(
    keyForTenantConversation(stream.tenantId, stream.conversationId),
  );
}
