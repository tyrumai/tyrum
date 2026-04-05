import { WsTaskExecuteResult } from "@tyrum/contracts";
import type { WsEventEnvelope, WsResponseEnvelope } from "@tyrum/contracts";
import { DispatchRecordDal } from "../../app/modules/node/dispatch-record-dal.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorEvent } from "./helpers.js";
import {
  CLUSTER_TASK_RESULT_RELAY_TOPIC,
  associateClusterTaskResultRoute,
  consumeClusterTaskResultRoute,
} from "./cluster-task-result-routing.js";
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

async function handleTaskExecuteResponse(
  client: ConnectedClient,
  msg: ProtocolResponseEnvelope,
  deps: ProtocolDeps,
): Promise<WsEventEnvelope | undefined> {
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
  const taskResult = {
    ok: msg.ok,
    ...(msg.ok && evidenceAndResult?.success ? { result: evidenceAndResult.data.result } : {}),
    ...(msg.ok && evidenceAndResult?.success && evidenceAndResult.data.evidence !== undefined
      ? { evidence: evidenceAndResult.data.evidence }
      : {}),
    ...(!msg.ok ? { error: msg.error.message } : {}),
  };
  const tenantId = client.auth_claims?.tenant_id;

  if (tenantId && deps.db) {
    try {
      await new DispatchRecordDal(deps.db).completeByTaskId({
        tenantId,
        taskId: msg.request_id,
        ok: taskResult.ok,
        result: taskResult.result,
        evidence: taskResult.evidence,
        error: taskResult.error,
      });
    } catch (error) {
      deps.logger?.warn("ws.task_result.dispatch_record_update_failed", {
        request_id: msg.request_id,
        tenant_id: tenantId,
        connection_id: client.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const clusterTaskResultRoute = consumeClusterTaskResultRoute(msg.request_id);
  if (clusterTaskResultRoute) {
    if (deps.cluster) {
      try {
        await deps.cluster.outboxDal.enqueue(
          clusterTaskResultRoute.tenantId,
          CLUSTER_TASK_RESULT_RELAY_TOPIC,
          {
            task_id: msg.request_id,
            task_result: taskResult,
          },
          { targetEdgeId: clusterTaskResultRoute.originEdgeId },
        );
      } catch (error) {
        associateClusterTaskResultRoute(msg.request_id, clusterTaskResultRoute);
        deps.logger?.warn("ws.cluster_task_result_relay_failed", {
          request_id: msg.request_id,
          tenant_id: clusterTaskResultRoute.tenantId,
          origin_edge_id: clusterTaskResultRoute.originEdgeId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return undefined;
    }

    associateClusterTaskResultRoute(msg.request_id, clusterTaskResultRoute);
  }

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
