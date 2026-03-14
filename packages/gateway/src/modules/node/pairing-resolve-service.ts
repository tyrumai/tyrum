import type {
  CapabilityDescriptor,
  NodePairingRequest as NodePairingRequestT,
  NodePairingTrustLevel,
  WsEventEnvelope,
} from "@tyrum/schemas";
import { isLegacyUmbrellaCapabilityDescriptorId } from "@tyrum/schemas";
import type { WsEventDal } from "../ws-event/dal.js";
import type { NodePairingDal } from "./pairing-dal.js";
import type { WsBroadcastAudience } from "../../ws/audience.js";
import { ensurePairingResolvedEvent } from "../../ws/stable-events.js";

export interface ResolveNodePairingDeps {
  nodePairingDal: Pick<NodePairingDal, "resolve" | "revoke">;
  wsEventDal?: WsEventDal;
  emitEvent?: (input: {
    tenantId: string;
    event: WsEventEnvelope;
    audience?: WsBroadcastAudience;
  }) => void;
  emitPairingApproved?: (input: {
    tenantId: string;
    pairing: NodePairingRequestT;
    nodeId: string;
    scopedToken: string;
  }) => void;
}

export type ResolveNodePairingInput =
  | {
      tenantId: string;
      pairingId: number;
      decision: "approved";
      reason?: string;
      trustLevel: NodePairingTrustLevel;
      capabilityAllowlist: readonly CapabilityDescriptor[];
      resolvedBy?: unknown;
    }
  | {
      tenantId: string;
      pairingId: number;
      decision: "denied" | "revoked";
      reason?: string;
      resolvedBy?: unknown;
    };

export type ResolveNodePairingResult =
  | {
      ok: true;
      pairing: NodePairingRequestT;
      scopedToken?: string;
    }
  | {
      ok: false;
      code: "invalid_request" | "not_found";
      message: string;
    };

function notFound(pairingId: number): ResolveNodePairingResult {
  return {
    ok: false,
    code: "not_found",
    message: `pairing ${String(pairingId)} not found or not resolvable`,
  };
}

export async function resolveNodePairing(
  deps: ResolveNodePairingDeps,
  input: ResolveNodePairingInput,
): Promise<ResolveNodePairingResult> {
  if (input.decision === "revoked") {
    const pairing = await deps.nodePairingDal.revoke({
      tenantId: input.tenantId,
      pairingId: input.pairingId,
      reason: input.reason,
      resolvedBy: input.resolvedBy,
      decisionPayload: {
        decision: "revoked",
        reason: input.reason ?? null,
        actor: input.resolvedBy ?? null,
      },
    });
    if (!pairing) {
      return notFound(input.pairingId);
    }

    if (deps.emitEvent) {
      const persistedEvent = await ensurePairingResolvedEvent({
        tenantId: input.tenantId,
        pairing,
        wsEventDal: deps.wsEventDal,
      });
      deps.emitEvent({ tenantId: input.tenantId, event: persistedEvent.event });
    }

    return { ok: true, pairing };
  }

  if (input.decision === "approved") {
    const legacyCapability = input.capabilityAllowlist.find((capability) =>
      isLegacyUmbrellaCapabilityDescriptorId(capability.id),
    );
    if (legacyCapability) {
      return {
        ok: false,
        code: "invalid_request",
        message: `legacy umbrella capability '${legacyCapability.id}' is not supported; approve exact split descriptors instead`,
      };
    }
    const resolved = await deps.nodePairingDal.resolve({
      tenantId: input.tenantId,
      pairingId: input.pairingId,
      decision: "approved",
      reason: input.reason,
      resolvedBy: input.resolvedBy,
      decisionPayload: {
        decision: "approved",
        reason: input.reason ?? null,
        trust_level: input.trustLevel,
        capability_allowlist: input.capabilityAllowlist,
        actor: input.resolvedBy ?? null,
      },
      trustLevel: input.trustLevel,
      capabilityAllowlist: input.capabilityAllowlist,
    });
    if (!resolved?.pairing) {
      return notFound(input.pairingId);
    }

    const { pairing, scopedToken, transitioned } = resolved;
    if (transitioned && scopedToken && deps.emitPairingApproved) {
      deps.emitPairingApproved({
        tenantId: input.tenantId,
        pairing,
        nodeId: pairing.node.node_id,
        scopedToken,
      });
    }

    if (transitioned && deps.emitEvent) {
      const persistedEvent = await ensurePairingResolvedEvent({
        tenantId: input.tenantId,
        pairing,
        wsEventDal: deps.wsEventDal,
        scopedToken,
      });
      deps.emitEvent({ tenantId: input.tenantId, event: persistedEvent.event });
    }

    return { ok: true, pairing, scopedToken };
  }

  const resolved = await deps.nodePairingDal.resolve({
    tenantId: input.tenantId,
    pairingId: input.pairingId,
    decision: "denied",
    reason: input.reason,
    resolvedBy: input.resolvedBy,
    decisionPayload: {
      decision: "denied",
      reason: input.reason ?? null,
      actor: input.resolvedBy ?? null,
    },
  });
  if (!resolved?.pairing) {
    return notFound(input.pairingId);
  }

  const { pairing } = resolved;
  if (deps.emitEvent) {
    const persistedEvent = await ensurePairingResolvedEvent({
      tenantId: input.tenantId,
      pairing,
      wsEventDal: deps.wsEventDal,
    });
    deps.emitEvent({ tenantId: input.tenantId, event: persistedEvent.event });
  }

  return { ok: true, pairing };
}
