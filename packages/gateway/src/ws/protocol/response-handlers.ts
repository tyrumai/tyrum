import { WsTaskExecuteResult } from "@tyrum/contracts";
import type { WsEventEnvelope, WsResponseEnvelope } from "@tyrum/contracts";
import type { ConnectedClient } from "../connection-manager.js";
import { errorEvent } from "./helpers.js";
import type { ProtocolDeps, ProtocolResponseEnvelope } from "./types.js";

export async function handleResponseMessage(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | WsEventEnvelope | undefined> {
  if (msg.type === "task.execute") {
    return handleTaskExecuteResponse(client, msg, deps);
  }

  return undefined;
}

function evidenceFromErrorDetails(details: unknown): unknown {
  if (details === null || typeof details !== "object") {
    return undefined;
  }
  return (details as { evidence?: unknown }).evidence;
}

function handleTaskExecuteResponse(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): WsEventEnvelope | undefined {
  if (client.role !== "node") {
    deps.logger?.warn("ws.task_result_unauthorized_role", {
      request_id: msg.request_id,
      connection_id: client.id,
      role: client.role,
    });
    return errorEvent("unauthorized", "only nodes may respond to task.execute");
  }

  const expectedConnectionId = deps.taskResults?.getAssociatedConnectionId(msg.request_id);
  if (expectedConnectionId && expectedConnectionId !== client.id) {
    deps.logger?.warn("ws.task_result_unexpected_connection", {
      request_id: msg.request_id,
      connection_id: client.id,
      expected_connection_id: expectedConnectionId,
    });
    return errorEvent("unauthorized", "task.execute result received from an unexpected connection");
  }

  const evidenceAndResult = msg.ok ? WsTaskExecuteResult.safeParse(msg.result ?? {}) : undefined;
  const failureEvidence = !msg.ok ? evidenceFromErrorDetails(msg.error.details) : undefined;

  deps.onTaskResult?.(
    msg.request_id,
    msg.ok,
    msg.ok ? (evidenceAndResult?.success ? evidenceAndResult.data.result : undefined) : undefined,
    msg.ok
      ? evidenceAndResult?.success
        ? evidenceAndResult.data.evidence
        : undefined
      : failureEvidence,
    msg.ok ? undefined : msg.error.message,
  );
  return undefined;
}
