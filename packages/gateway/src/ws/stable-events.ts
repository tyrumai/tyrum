import type { Approval, NodePairingRequest, PolicyOverride, WsEventEnvelope } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { PersistedWsEvent, WsEventDal } from "../modules/ws-event/dal.js";
import type { WsBroadcastAudience } from "./audience.js";

async function ensureStableWsEvent(input: {
  tenantId: string;
  eventKey: string;
  type: WsEventEnvelope["type"];
  occurredAt: string;
  payload: unknown;
  audience?: WsBroadcastAudience;
  wsEventDal?: WsEventDal;
}): Promise<PersistedWsEvent> {
  if (!input.wsEventDal) {
    return {
      event: {
        event_id: randomUUID(),
        type: input.type,
        occurred_at: input.occurredAt,
        payload: input.payload,
      },
      audience: input.audience,
    };
  }

  return await input.wsEventDal.ensureEvent({
    tenantId: input.tenantId,
    eventKey: input.eventKey,
    type: input.type,
    occurredAt: input.occurredAt,
    payload: input.payload,
    audience: input.audience,
  });
}

export async function ensureApprovalResolvedEvent(input: {
  tenantId: string;
  approval: Approval;
  wsEventDal?: WsEventDal;
}): Promise<PersistedWsEvent> {
  return await ensureStableWsEvent({
    tenantId: input.tenantId,
    eventKey: `approval.resolved:${input.approval.approval_id}:${input.approval.status}`,
    type: "approval.resolved",
    occurredAt: input.approval.resolution?.resolved_at ?? input.approval.created_at,
    payload: { approval: input.approval },
    wsEventDal: input.wsEventDal,
  });
}

export async function ensurePairingResolvedEvent(input: {
  tenantId: string;
  pairing: NodePairingRequest;
  wsEventDal?: WsEventDal;
}): Promise<PersistedWsEvent> {
  return await ensureStableWsEvent({
    tenantId: input.tenantId,
    // Pairings can later transition from approved to revoked; include the terminal status
    // so retries reuse the same id without collapsing distinct transitions.
    eventKey: `pairing.resolved:${String(input.pairing.pairing_id)}:${input.pairing.status}`,
    type: "pairing.resolved",
    occurredAt:
      input.pairing.resolution?.resolved_at ??
      input.pairing.resolved_at ??
      input.pairing.requested_at,
    payload: { pairing: input.pairing },
    wsEventDal: input.wsEventDal,
  });
}

export async function ensurePolicyOverrideCreatedEvent(input: {
  tenantId: string;
  override: PolicyOverride;
  audience?: WsBroadcastAudience;
  wsEventDal?: WsEventDal;
}): Promise<PersistedWsEvent> {
  return await ensureStableWsEvent({
    tenantId: input.tenantId,
    eventKey: `policy_override.created:${input.override.policy_override_id}`,
    type: "policy_override.created",
    occurredAt: input.override.created_at,
    payload: { override: input.override },
    audience: input.audience,
    wsEventDal: input.wsEventDal,
  });
}
