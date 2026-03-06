import {
  WsCapabilityReadyRequest,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsPairingResolveResult,
  WsPairingRevokeRequest,
  clientCapabilityFromDescriptorId,
} from "@tyrum/schemas";
import type {
  ClientCapability,
  NodePairingRequest as NodePairingRequestT,
  WsResponseEnvelope,
} from "@tyrum/schemas";
import { emitPairingApprovedEvent } from "../pairing-approved.js";
import type { ConnectedClient } from "../connection-manager.js";
import { ensurePairingResolvedEvent } from "../stable-events.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import {
  handleAttemptEvidenceMessage,
  handlePresenceBeaconMessage,
} from "./node-runtime-handlers.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

export async function handleNodeMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  raw: string,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (
    msg.type === "pairing.approve" ||
    msg.type === "pairing.deny" ||
    msg.type === "pairing.revoke"
  ) {
    return handlePairingMessage(client, msg, deps);
  }

  if (msg.type === "capability.ready") {
    return handleCapabilityReadyMessage(client, msg, deps);
  }

  if (msg.type === "attempt.evidence") {
    return handleAttemptEvidenceMessage(client, msg, raw, deps);
  }

  if (msg.type !== "presence.beacon") {
    return undefined;
  }

  return handlePresenceBeaconMessage(client, msg, deps);
}

async function handlePairingMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may resolve pairings",
    );
  }
  if (!deps.nodePairingDal) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "pairing resolution not supported",
    );
  }

  const resolvedBy = {
    kind: "ws" as const,
    client_id: client.id,
    device_id: client.device_id,
  };
  const resolved = await resolvePairing(msg, deps, resolvedBy);
  if ("response" in resolved) {
    return resolved.response;
  }

  if (msg.type === "pairing.approve" && resolved.scopedToken) {
    emitPairingApprovedEvent(deps, tenantId, {
      pairing: resolved.pairing,
      nodeId: resolved.pairing.node.node_id,
      scopedToken: resolved.scopedToken,
    });
  }

  const persistedEvent = await ensurePairingResolvedEvent({
    tenantId,
    pairing: resolved.pairing,
    wsEventDal: deps.wsEventDal,
  });
  broadcastEvent(tenantId, persistedEvent.event, deps, persistedEvent.audience);
  const result = WsPairingResolveResult.parse({ pairing: resolved.pairing });
  return { request_id: msg.request_id, type: msg.type, ok: true, result };
}

function handleCapabilityReadyMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): WsResponseEnvelope {
  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }
  if (client.role !== "node") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only nodes may report capability readiness",
    );
  }

  const parsedReq = WsCapabilityReadyRequest.safeParse(msg);
  if (!parsedReq.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsedReq.error.message, {
      issues: parsedReq.error.issues,
    });
  }

  const readyLegacyCaps = parsedReq.data.payload.capabilities
    .map((capability) => clientCapabilityFromDescriptorId(capability.id))
    .filter((capability): capability is ClientCapability => capability !== undefined)
    .filter((capability) => client.capabilities.includes(capability));

  deps.connectionManager.setReadyCapabilities(client.id, readyLegacyCaps);

  if (deps.cluster) {
    void deps.cluster.connectionDirectory
      .setReadyCapabilities({
        tenantId,
        connectionId: client.id,
        readyCapabilities: [...client.readyCapabilities].toSorted(),
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("ws.capability_ready.persistence_failed", {
          request_id: msg.request_id,
          client_id: client.id,
          request_type: msg.type,
          error: message,
        });
      });
  }

  const nodeId = client.device_id ?? client.id;
  broadcastEvent(
    tenantId,
    {
      event_id: crypto.randomUUID(),
      type: "capability.ready",
      occurred_at: new Date().toISOString(),
      scope: { kind: "node", node_id: nodeId },
      payload: {
        node_id: nodeId,
        capabilities: parsedReq.data.payload.capabilities,
      },
    },
    deps,
  );

  return { request_id: msg.request_id, type: msg.type, ok: true };
}

async function resolvePairing(
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
  resolvedBy: { kind: "ws"; client_id: string; device_id?: string },
): Promise<
  { response: WsResponseEnvelope } | { pairing: NodePairingRequestT; scopedToken?: string }
> {
  const notFound = (pairingId: number) => {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "not_found",
        `pairing ${String(pairingId)} not found or not resolvable`,
      ),
    };
  };

  if (msg.type === "pairing.approve") {
    const parsedReq = WsPairingApproveRequest.safeParse(msg);
    if (!parsedReq.success) {
      return {
        response: errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          parsedReq.error.message,
          {
            issues: parsedReq.error.issues,
          },
        ),
      };
    }

    const resolved = await deps.nodePairingDal!.resolve({
      pairingId: parsedReq.data.payload.pairing_id,
      decision: "approved",
      reason: parsedReq.data.payload.reason,
      resolvedBy,
      trustLevel: parsedReq.data.payload.trust_level,
      capabilityAllowlist: parsedReq.data.payload.capability_allowlist,
    });
    if (!resolved?.pairing) {
      return notFound(parsedReq.data.payload.pairing_id);
    }
    return { pairing: resolved.pairing, scopedToken: resolved.scopedToken };
  }

  if (msg.type === "pairing.deny") {
    const parsedReq = WsPairingDenyRequest.safeParse(msg);
    if (!parsedReq.success) {
      return {
        response: errorResponse(
          msg.request_id,
          msg.type,
          "invalid_request",
          parsedReq.error.message,
          {
            issues: parsedReq.error.issues,
          },
        ),
      };
    }

    const resolved = await deps.nodePairingDal!.resolve({
      pairingId: parsedReq.data.payload.pairing_id,
      decision: "denied",
      reason: parsedReq.data.payload.reason,
      resolvedBy,
    });
    if (!resolved?.pairing) {
      return notFound(parsedReq.data.payload.pairing_id);
    }
    return { pairing: resolved.pairing };
  }

  const parsedReq = WsPairingRevokeRequest.safeParse(msg);
  if (!parsedReq.success) {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        parsedReq.error.message,
        {
          issues: parsedReq.error.issues,
        },
      ),
    };
  }

  const pairing = await deps.nodePairingDal!.revoke({
    pairingId: parsedReq.data.payload.pairing_id,
    reason: parsedReq.data.payload.reason,
    resolvedBy,
  });
  if (!pairing) {
    return notFound(parsedReq.data.payload.pairing_id);
  }
  return { pairing };
}
