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
  sessionId: string;
  streamId: string;
  tenantId: string;
};

const activeStreamsById = new Map<string, ActiveChatStream>();
const activeStreamIdByTenantSession = new Map<string, string>();

function keyForTenantSession(tenantId: string, sessionId: string): string {
  return `${tenantId}:${sessionId}`;
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
  sessionId: string;
  tenantId: string;
}): string {
  const streamId = randomUUID();
  const stream: ActiveChatStream = {
    agentId: input.agentId,
    clientIds: new Set([input.clientId]),
    sessionId: input.sessionId,
    streamId,
    tenantId: input.tenantId,
  };
  activeStreamsById.set(streamId, stream);
  activeStreamIdByTenantSession.set(keyForTenantSession(input.tenantId, input.sessionId), streamId);
  return streamId;
}

export function reconnectAiSdkChatStream(input: {
  clientId: string;
  sessionId: string;
  tenantId: string;
}): string | null {
  const streamId = activeStreamIdByTenantSession.get(
    keyForTenantSession(input.tenantId, input.sessionId),
  );
  if (!streamId) {
    return null;
  }
  const stream = activeStreamsById.get(streamId);
  if (!stream) {
    activeStreamIdByTenantSession.delete(keyForTenantSession(input.tenantId, input.sessionId));
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
  activeStreamIdByTenantSession.delete(keyForTenantSession(stream.tenantId, stream.sessionId));
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
  activeStreamIdByTenantSession.delete(keyForTenantSession(stream.tenantId, stream.sessionId));
}
