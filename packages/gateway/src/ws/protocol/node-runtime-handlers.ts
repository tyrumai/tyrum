import {
  WsAttemptEvidenceRequest,
  WsPresenceBeaconRequest,
  WsPresenceBeaconResult,
} from "@tyrum/schemas";
import type { WsEventEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectedClient } from "../connection-manager.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleAttemptEvidenceMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  raw: string,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "node") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only nodes may report attempt evidence",
    );
  }

  const sizeError = validateAttemptEvidenceSize(msg, raw);
  if (sizeError) {
    return sizeError;
  }

  const parsedReq = WsAttemptEvidenceRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const nodeId = client.device_id ?? client.id;
  const pairingError = await ensureApprovedNodePairing(client, msg, deps, nodeId);
  if (pairingError) {
    return pairingError;
  }

  const attempt = await loadAttemptForEvidence(msg, parsedReq.data.payload.attempt_id, deps);
  if ("response" in attempt) {
    return attempt.response;
  }

  const payload = parsedReq.data.payload;
  const scopeError = validateAttemptScope(msg, attempt.attempt, payload);
  if (scopeError) {
    return scopeError;
  }

  const executorError = validateAttemptExecutor({
    msg,
    payload,
    nodeId,
    attempt: attempt.attempt,
    deps,
  });
  if (executorError) {
    return executorError;
  }

  broadcastEvent(
    tenantId,
    {
      event_id: crypto.randomUUID(),
      type: "attempt.evidence",
      occurred_at: new Date().toISOString(),
      scope: { kind: "run", run_id: payload.run_id },
      payload: {
        node_id: nodeId,
        run_id: payload.run_id,
        step_id: payload.step_id,
        attempt_id: payload.attempt_id,
        evidence: payload.evidence,
      },
    },
    deps,
  );

  return { request_id: msg.request_id, type: msg.type, ok: true };
}

export async function handlePresenceBeaconMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (!deps.presenceDal || !client.device_id) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "presence.beacon not supported",
    );
  }

  const parsedReq = WsPresenceBeaconRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const row = await deps.presenceDal.upsert({
    instanceId: client.device_id,
    role: client.role,
    connectionId: client.id,
    host: parsedReq.data.payload.host ?? null,
    ip: parsedReq.data.payload.ip ?? null,
    version: parsedReq.data.payload.version ?? null,
    mode: parsedReq.data.payload.mode ?? null,
    lastInputSeconds: parsedReq.data.payload.last_input_seconds ?? null,
    metadata: parsedReq.data.payload.metadata ?? {},
    nowMs: Date.now(),
    ttlMs: deps.presenceTtlMs ?? 60_000,
  });

  const entry = {
    instance_id: row.instance_id,
    role: row.role,
    host: row.host ?? undefined,
    ip: row.ip ?? undefined,
    version: row.version ?? undefined,
    mode: (row.mode ?? undefined) as string | undefined,
    last_seen_at: new Date(row.last_seen_at_ms).toISOString(),
    last_input_seconds: row.last_input_seconds ?? undefined,
    reason: "periodic" as const,
    metadata: row.metadata,
  };

  const event = {
    event_id: crypto.randomUUID(),
    type: "presence.upserted",
    occurred_at: new Date().toISOString(),
    payload: { entry },
  } satisfies WsEventEnvelope;

  broadcastPresenceEvent(tenantId, client, msg, event, deps);
  enqueuePresenceClusterBroadcast(tenantId, client, msg, event, deps);

  const result = WsPresenceBeaconResult.parse({ entry });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

function validateAttemptEvidenceSize(
  msg: ProtocolRequestEnvelope,
  raw: string,
): WsResponseEnvelope | undefined {
  const maxAttemptEvidenceChars = 256 * 1024;
  if (raw.length <= maxAttemptEvidenceChars) {
    return undefined;
  }
  return errorResponse(
    msg.request_id,
    msg.type,
    "invalid_request",
    "attempt evidence payload too large",
    {
      max_chars: maxAttemptEvidenceChars,
      actual_chars: raw.length,
    },
  );
}

async function ensureApprovedNodePairing(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
  nodeId: string,
): Promise<WsResponseEnvelope | undefined> {
  if (!deps.nodePairingDal) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "attempt evidence not supported",
    );
  }

  try {
    const pairing = await deps.nodePairingDal.getByNodeId(nodeId);
    if (pairing?.status === "approved") {
      return undefined;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.error("ws.attempt_evidence.pairing_lookup_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      node_id: nodeId,
      error: message,
    });
    return errorResponse(msg.request_id, msg.type, "unauthorized", "node is not paired");
  }

  return errorResponse(msg.request_id, msg.type, "unauthorized", "node is not paired");
}

async function loadAttemptForEvidence(
  msg: ProtocolRequestEnvelope,
  attemptId: string,
  deps: ProtocolDeps,
): Promise<
  | { response: WsResponseEnvelope }
  | { attempt: { run_id: string; step_id: string; status: string; metadata_json: string | null } }
> {
  if (!deps.db) {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "unsupported_request",
        "attempt evidence not supported",
      ),
    };
  }

  const attempt = await deps.db.get<{
    run_id: string;
    step_id: string;
    status: string;
    metadata_json: string | null;
  }>(
    `SELECT
       s.run_id AS run_id,
       a.step_id AS step_id,
       a.status AS status,
       a.metadata_json AS metadata_json
     FROM execution_attempts a
     JOIN execution_steps s ON s.step_id = a.step_id
     WHERE a.attempt_id = ?`,
    [attemptId],
  );
  if (!attempt) {
    return {
      response: errorResponse(msg.request_id, msg.type, "invalid_request", "unknown attempt_id"),
    };
  }
  return { attempt };
}

function validateAttemptScope(
  msg: ProtocolRequestEnvelope,
  attempt: { run_id: string; step_id: string; status: string },
  payload: { run_id: string; step_id: string },
): WsResponseEnvelope | undefined {
  if (attempt.run_id !== payload.run_id || attempt.step_id !== payload.step_id) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", "attempt scope mismatch");
  }
  if (attempt.status !== "running") {
    return errorResponse(msg.request_id, msg.type, "invalid_state", "attempt is not running", {
      status: attempt.status,
    });
  }
  return undefined;
}

function validateAttemptExecutor(params: {
  msg: ProtocolRequestEnvelope;
  payload: { attempt_id: string };
  nodeId: string;
  attempt: { metadata_json: string | null };
  deps: ProtocolDeps;
}): WsResponseEnvelope | undefined {
  const dispatchedNodeId =
    resolveDispatchedNodeId(params.attempt.metadata_json) ??
    params.deps.connectionManager.getDispatchedAttemptExecutor(params.payload.attempt_id);
  if (!dispatchedNodeId) {
    return errorResponse(
      params.msg.request_id,
      params.msg.type,
      "invalid_state",
      "attempt executor metadata missing; evidence cannot be authorized",
    );
  }
  if (dispatchedNodeId !== params.nodeId) {
    return errorResponse(
      params.msg.request_id,
      params.msg.type,
      "unauthorized",
      "node is not the dispatched executor for this attempt",
    );
  }
  return undefined;
}

function broadcastPresenceEvent(
  tenantId: string,
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  event: WsEventEnvelope,
  deps: ProtocolDeps,
): void {
  const payload = JSON.stringify(event);
  let failedPeerSends = 0;
  let exampleSendFailure: { peer_id: string; peer_role: string; error: string } | undefined;

  for (const peer of deps.connectionManager.allClients()) {
    if (peer.auth_claims?.tenant_id !== tenantId) continue;
    try {
      peer.ws.send(payload);
    } catch (err) {
      failedPeerSends += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (!exampleSendFailure) {
        exampleSendFailure = { peer_id: peer.id, peer_role: peer.role, error: message };
      }
    }
  }

  if (failedPeerSends > 0) {
    deps.logger?.warn("ws.presence_beacon.broadcast_failed", {
      request_id: msg.request_id,
      client_id: client.id,
      request_type: msg.type,
      failed_peer_count: failedPeerSends,
      ...(exampleSendFailure
        ? {
            example_peer_id: exampleSendFailure.peer_id,
            example_peer_role: exampleSendFailure.peer_role,
            example_error: exampleSendFailure.error,
          }
        : {}),
    });
  }
}

function enqueuePresenceClusterBroadcast(
  tenantId: string,
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  event: WsEventEnvelope,
  deps: ProtocolDeps,
): void {
  if (!deps.cluster) {
    return;
  }

  void deps.cluster.outboxDal
    .enqueue(tenantId, "ws.broadcast", {
      source_edge_id: deps.cluster.edgeId,
      skip_local: true,
      message: event,
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn("ws.presence_beacon.cluster_enqueue_failed", {
        request_id: msg.request_id,
        client_id: client.id,
        request_type: msg.type,
        topic: "ws.broadcast",
        error: message,
      });
    });
}

function resolveDispatchedNodeId(metadataJson: string | null): string | undefined {
  if (typeof metadataJson !== "string" || metadataJson.trim().length === 0) {
    return undefined;
  }

  try {
    const metadata = JSON.parse(metadataJson) as unknown;
    if (!isObject(metadata)) return undefined;
    const executor = metadata["executor"];
    if (!isObject(executor) || executor["kind"] !== "node") return undefined;
    const executorNodeId = executor["node_id"];
    return typeof executorNodeId === "string" && executorNodeId.trim().length > 0
      ? executorNodeId
      : undefined;
  } catch (_err) {
    void _err;
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
