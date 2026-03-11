import {
  WsCapabilityReadyRequest,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsPairingResolveResult,
  WsPairingRevokeRequest,
  normalizeCapabilityDescriptors,
} from "@tyrum/schemas";
import type { CapabilityDescriptor, WsResponseEnvelope } from "@tyrum/schemas";
import { resolveNodePairing } from "../../modules/node/pairing-resolve-service.js";
import { PAIRING_WS_AUDIENCE } from "../audience.js";
import { emitPairingApprovedEvent } from "../pairing-approved.js";
import type { ConnectedClient } from "../connection-manager.js";
import { broadcastEvent, errorResponse } from "./helpers.js";
import {
  handleAttemptEvidenceMessage,
  handleLocationBeaconMessage,
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

  if (msg.type === "location.beacon") {
    return handleLocationBeaconMessage(client, msg, deps);
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
  const parsed = parsePairingRequest(msg);
  if ("response" in parsed) {
    return parsed.response;
  }

  const result = await resolveNodePairing(
    {
      nodePairingDal: deps.nodePairingDal,
      wsEventDal: deps.wsEventDal,
      emitEvent: ({ tenantId: eventTenantId, event }) => {
        broadcastEvent(eventTenantId, event, deps, PAIRING_WS_AUDIENCE);
      },
      emitPairingApproved: ({ tenantId: eventTenantId, pairing, nodeId, scopedToken }) => {
        emitPairingApprovedEvent(deps, eventTenantId, {
          pairing,
          nodeId,
          scopedToken,
        });
      },
    },
    {
      tenantId,
      ...parsed.input,
      resolvedBy,
    },
  );
  if (!result.ok) {
    return errorResponse(msg.request_id, msg.type, result.code, result.message);
  }

  const payload = WsPairingResolveResult.parse({ pairing: result.pairing });
  return { request_id: msg.request_id, type: msg.type, ok: true, result: payload };
}

function parsePairingRequest(msg: ProtocolRequestEnvelope):
  | { response: WsResponseEnvelope }
  | {
      input:
        | {
            pairingId: number;
            decision: "approved";
            reason?: string;
            trustLevel: "local" | "remote";
            capabilityAllowlist: readonly CapabilityDescriptor[];
          }
        | {
            pairingId: number;
            decision: "denied" | "revoked";
            reason?: string;
          };
    } {
  const invalidRequest = (message: string, issues?: unknown) => {
    return {
      response: errorResponse(
        msg.request_id,
        msg.type,
        "invalid_request",
        message,
        issues ? { issues } : undefined,
      ),
    };
  };

  if (msg.type === "pairing.approve") {
    const parsedReq = WsPairingApproveRequest.safeParse(msg);
    if (!parsedReq.success) {
      return invalidRequest(parsedReq.error.message, parsedReq.error.issues);
    }

    return {
      input: {
        pairingId: parsedReq.data.payload.pairing_id,
        decision: "approved",
        reason: parsedReq.data.payload.reason,
        trustLevel: parsedReq.data.payload.trust_level,
        capabilityAllowlist: parsedReq.data.payload.capability_allowlist,
      },
    };
  }

  if (msg.type === "pairing.deny") {
    const parsedReq = WsPairingDenyRequest.safeParse(msg);
    if (!parsedReq.success) {
      return invalidRequest(parsedReq.error.message, parsedReq.error.issues);
    }

    return {
      input: {
        pairingId: parsedReq.data.payload.pairing_id,
        decision: "denied",
        reason: parsedReq.data.payload.reason,
      },
    };
  }

  const parsedReq = WsPairingRevokeRequest.safeParse(msg);
  if (!parsedReq.success) {
    return invalidRequest(parsedReq.error.message, parsedReq.error.issues);
  }

  return {
    input: {
      pairingId: parsedReq.data.payload.pairing_id,
      decision: "revoked",
      reason: parsedReq.data.payload.reason,
    },
  };
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

  const advertisedIds = new Set(client.capabilities.map((capability) => capability.id));
  const readyCapabilities = normalizeCapabilityDescriptors(
    parsedReq.data.payload.capabilities,
  ).filter((capability) => advertisedIds.has(capability.id));
  const capabilityStates = parsedReq.data.payload.capability_states.filter((state) => {
    return advertisedIds.has(state.capability.id);
  });

  deps.connectionManager.setReadyCapabilities(client.id, readyCapabilities);
  deps.connectionManager.setCapabilityStates(client.id, capabilityStates);

  if (deps.cluster) {
    void deps.cluster.connectionDirectory
      .setReadyCapabilities({
        tenantId,
        connectionId: client.id,
        readyCapabilities: [...client.readyCapabilities].toSorted((a, b) =>
          a.id.localeCompare(b.id),
        ),
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
    void deps.cluster.connectionDirectory
      .setCapabilityStates({
        tenantId,
        connectionId: client.id,
        capabilityStates,
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.warn("ws.capability_state.persistence_failed", {
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
        capabilities: readyCapabilities,
        capability_states: capabilityStates,
      },
    },
    deps,
  );

  return { request_id: msg.request_id, type: msg.type, ok: true };
}
