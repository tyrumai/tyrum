import { randomUUID } from "node:crypto";
import type { WsEventEnvelope } from "@tyrum/schemas";
import { OPERATOR_WS_AUDIENCE } from "../audience.js";
import { enqueueWsBroadcastMessage } from "../outbox.js";
import type { ProtocolDeps } from "./types.js";

type SessionEventType =
  | "typing.started"
  | "typing.stopped"
  | "message.delta"
  | "message.final"
  | "reasoning.delta"
  | "reasoning.final"
  | "session.send.failed";

type SessionStreamPart =
  | { type: "text-delta"; id: string; delta: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "tool-approval-request" }
  | { type: string };

type TextDeltaPart = Extract<SessionStreamPart, { type: "text-delta" }>;
type ReasoningDeltaPart = Extract<SessionStreamPart, { type: "reasoning-delta" }>;

type SessionStreamHandle = {
  streamResult: {
    fullStream: AsyncIterable<SessionStreamPart>;
  };
};

async function emitSessionEvent(
  deps: ProtocolDeps,
  tenantId: string,
  event: WsEventEnvelope,
): Promise<void> {
  if (!deps.db) return;
  await enqueueWsBroadcastMessage(deps.db, tenantId, event, OPERATOR_WS_AUDIENCE);
}

async function emitSessionEventBestEffort(input: {
  deps: ProtocolDeps;
  tenantId: string;
  event: WsEventEnvelope;
  stage: "stream_failed" | "typing_stopped_after_error";
}): Promise<void> {
  const { deps, tenantId, event, stage } = input;
  try {
    await emitSessionEvent(deps, tenantId, event);
  } catch (error) {
    deps.logger?.warn("ws.session_send.event_emit_failed", {
      tenant_id: tenantId,
      stage,
      event_type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function createSessionEvent(input: {
  type: SessionEventType;
  agentId: string;
  payload: Record<string, unknown>;
}): WsEventEnvelope {
  return {
    event_id: randomUUID(),
    type: input.type,
    occurred_at: new Date().toISOString(),
    scope: { kind: "agent", agent_id: input.agentId },
    payload: input.payload,
  };
}

export async function broadcastSessionSendStream(input: {
  deps: ProtocolDeps;
  tenantId: string;
  agentId: string;
  sessionKey: string;
  threadId: string;
  clientMessageId: string;
  userContent: string;
  stream: SessionStreamHandle;
}): Promise<{
  approvalRequested: boolean;
}> {
  const { deps, tenantId, agentId, sessionKey, threadId, clientMessageId, userContent, stream } =
    input;
  const assistantParts = new Map<string, string>();
  const reasoningParts = new Map<string, string>();
  let approvalRequested = false;
  let streamError: unknown;

  await emitSessionEvent(
    deps,
    tenantId,
    createSessionEvent({
      type: "typing.started",
      agentId,
      payload: {
        session_id: sessionKey,
        thread_id: threadId,
        lane: "assistant",
      },
    }),
  );
  await emitSessionEvent(
    deps,
    tenantId,
    createSessionEvent({
      type: "message.final",
      agentId,
      payload: {
        session_id: sessionKey,
        thread_id: threadId,
        lane: "user",
        message_id: clientMessageId,
        role: "user",
        content: userContent,
      },
    }),
  );

  try {
    for await (const part of stream.streamResult.fullStream) {
      switch (part.type) {
        case "text-delta": {
          const textPart = part as TextDeltaPart;
          const next = `${assistantParts.get(textPart.id) ?? ""}${textPart.delta}`;
          assistantParts.set(textPart.id, next);
          await emitSessionEvent(
            deps,
            tenantId,
            createSessionEvent({
              type: "message.delta",
              agentId,
              payload: {
                session_id: sessionKey,
                thread_id: threadId,
                lane: "assistant",
                message_id: textPart.id,
                role: "assistant",
                delta: textPart.delta,
              },
            }),
          );
          break;
        }
        case "reasoning-delta": {
          const reasoningPart = part as ReasoningDeltaPart;
          const next = `${reasoningParts.get(reasoningPart.id) ?? ""}${reasoningPart.delta}`;
          reasoningParts.set(reasoningPart.id, next);
          await emitSessionEvent(
            deps,
            tenantId,
            createSessionEvent({
              type: "reasoning.delta",
              agentId,
              payload: {
                session_id: sessionKey,
                thread_id: threadId,
                lane: "assistant",
                reasoning_id: reasoningPart.id,
                delta: reasoningPart.delta,
              },
            }),
          );
          break;
        }
        case "tool-approval-request":
          approvalRequested = true;
          break;
        default:
          break;
      }
    }
  } catch (error) {
    streamError = error;
    if (assistantParts.size > 0 || reasoningParts.size > 0) {
      await emitSessionEventBestEffort({
        deps,
        tenantId,
        stage: "stream_failed",
        event: createSessionEvent({
          type: "session.send.failed",
          agentId,
          payload: {
            session_id: sessionKey,
            thread_id: threadId,
            lane: "assistant",
            user_message_id: clientMessageId,
            message_ids: [...assistantParts.keys()],
            reasoning_ids: [...reasoningParts.keys()],
          },
        }),
      });
    }
    throw error;
  } finally {
    const typingStoppedEvent = createSessionEvent({
      type: "typing.stopped",
      agentId,
      payload: {
        session_id: sessionKey,
        thread_id: threadId,
        lane: "assistant",
      },
    });
    if (streamError) {
      await emitSessionEventBestEffort({
        deps,
        tenantId,
        stage: "typing_stopped_after_error",
        event: typingStoppedEvent,
      });
    } else {
      await emitSessionEvent(deps, tenantId, typingStoppedEvent);
    }
  }

  for (const [messageId, content] of assistantParts) {
    await emitSessionEvent(
      deps,
      tenantId,
      createSessionEvent({
        type: "message.final",
        agentId,
        payload: {
          session_id: sessionKey,
          thread_id: threadId,
          lane: "assistant",
          message_id: messageId,
          role: "assistant",
          content,
        },
      }),
    );
  }
  for (const [reasoningId, content] of reasoningParts) {
    await emitSessionEvent(
      deps,
      tenantId,
      createSessionEvent({
        type: "reasoning.final",
        agentId,
        payload: {
          session_id: sessionKey,
          thread_id: threadId,
          lane: "assistant",
          reasoning_id: reasoningId,
          content,
        },
      }),
    );
  }

  return { approvalRequested };
}
