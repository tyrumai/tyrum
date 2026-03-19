import {
  isLegacyUmbrellaCapabilityDescriptorId,
  type CapabilityDescriptor,
  type NodePairingRequest,
  type NodePairingTrustLevel,
  type WsEventEnvelope,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";

export interface ResolveNodePairingStore {
  resolve(input: {
    tenantId: string;
    pairingId: number;
    decision: "approved" | "denied";
    reason?: string;
    resolvedBy?: unknown;
    decisionPayload: Record<string, unknown>;
    trustLevel?: NodePairingTrustLevel;
    capabilityAllowlist?: readonly CapabilityDescriptor[];
  }): Promise<
    | {
        pairing: NodePairingRequest;
        scopedToken?: string;
        transitioned?: boolean;
      }
    | undefined
  >;
  revoke(input: {
    tenantId: string;
    pairingId: number;
    reason?: string;
    resolvedBy?: unknown;
    decisionPayload: Record<string, unknown>;
  }): Promise<NodePairingRequest | undefined>;
}

export interface ResolveNodePairingDeps {
  nodePairingDal: Pick<ResolveNodePairingStore, "resolve" | "revoke">;
  createResolvedEvent?: (input: {
    tenantId: string;
    pairing: NodePairingRequest;
    scopedToken?: string;
  }) => Promise<WsEventEnvelope>;
  emitEvent?: (input: { tenantId: string; event: WsEventEnvelope }) => void;
  emitPairingApproved?: (input: {
    tenantId: string;
    pairing: NodePairingRequest;
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
      pairing: NodePairingRequest;
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

async function emitResolvedEvent(
  deps: ResolveNodePairingDeps,
  input: { tenantId: string; pairing: NodePairingRequest; scopedToken?: string },
): Promise<void> {
  if (!deps.emitEvent) {
    return;
  }

  const event = deps.createResolvedEvent
    ? await deps.createResolvedEvent(input)
    : ({
        event_id: randomUUID(),
        type: "pairing.updated",
        occurred_at: input.pairing.requested_at,
        payload: {
          pairing: input.pairing,
          ...(input.scopedToken ? { scoped_token: input.scopedToken } : {}),
        },
      } satisfies WsEventEnvelope);
  deps.emitEvent({ tenantId: input.tenantId, event });
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

    await emitResolvedEvent(deps, { tenantId: input.tenantId, pairing });
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

    if (transitioned) {
      await emitResolvedEvent(deps, {
        tenantId: input.tenantId,
        pairing,
        scopedToken,
      });
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

  await emitResolvedEvent(deps, {
    tenantId: input.tenantId,
    pairing: resolved.pairing,
  });
  return { ok: true, pairing: resolved.pairing };
}
