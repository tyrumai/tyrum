import { z } from "zod";
import { CapabilityDescriptor } from "../capability.js";
import { NodePairingRequest, NodePairingTrustLevel } from "../node.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — pairing
// ---------------------------------------------------------------------------

export const WsPairingApprovePayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
    trust_level: NodePairingTrustLevel,
    capability_allowlist: z.array(CapabilityDescriptor),
  })
  .strict();
export type WsPairingApprovePayload = z.infer<typeof WsPairingApprovePayload>;

export const WsPairingApproveRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.approve"),
  payload: WsPairingApprovePayload,
});
export type WsPairingApproveRequest = z.infer<typeof WsPairingApproveRequest>;

export const WsPairingDenyPayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingDenyPayload = z.infer<typeof WsPairingDenyPayload>;

export const WsPairingDenyRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.deny"),
  payload: WsPairingDenyPayload,
});
export type WsPairingDenyRequest = z.infer<typeof WsPairingDenyRequest>;

export const WsPairingRevokePayload = z
  .object({
    pairing_id: z.number().int().positive(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type WsPairingRevokePayload = z.infer<typeof WsPairingRevokePayload>;

export const WsPairingRevokeRequest = WsRequestEnvelope.extend({
  type: z.literal("pairing.revoke"),
  payload: WsPairingRevokePayload,
});
export type WsPairingRevokeRequest = z.infer<typeof WsPairingRevokeRequest>;

export const WsPairingResolveResult = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingResolveResult = z.infer<typeof WsPairingResolveResult>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — pairing
// ---------------------------------------------------------------------------

export const WsPairingApproveResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.approve"),
  result: WsPairingResolveResult,
});
export type WsPairingApproveResponseOkEnvelope = z.infer<typeof WsPairingApproveResponseOkEnvelope>;

export const WsPairingApproveResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.approve"),
});
export type WsPairingApproveResponseErrEnvelope = z.infer<
  typeof WsPairingApproveResponseErrEnvelope
>;

export const WsPairingApproveResponseEnvelope = z.union([
  WsPairingApproveResponseOkEnvelope,
  WsPairingApproveResponseErrEnvelope,
]);
export type WsPairingApproveResponseEnvelope = z.infer<typeof WsPairingApproveResponseEnvelope>;

export const WsPairingDenyResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.deny"),
  result: WsPairingResolveResult,
});
export type WsPairingDenyResponseOkEnvelope = z.infer<typeof WsPairingDenyResponseOkEnvelope>;

export const WsPairingDenyResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.deny"),
});
export type WsPairingDenyResponseErrEnvelope = z.infer<typeof WsPairingDenyResponseErrEnvelope>;

export const WsPairingDenyResponseEnvelope = z.union([
  WsPairingDenyResponseOkEnvelope,
  WsPairingDenyResponseErrEnvelope,
]);
export type WsPairingDenyResponseEnvelope = z.infer<typeof WsPairingDenyResponseEnvelope>;

export const WsPairingRevokeResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("pairing.revoke"),
  result: WsPairingResolveResult,
});
export type WsPairingRevokeResponseOkEnvelope = z.infer<typeof WsPairingRevokeResponseOkEnvelope>;

export const WsPairingRevokeResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("pairing.revoke"),
});
export type WsPairingRevokeResponseErrEnvelope = z.infer<typeof WsPairingRevokeResponseErrEnvelope>;

export const WsPairingRevokeResponseEnvelope = z.union([
  WsPairingRevokeResponseOkEnvelope,
  WsPairingRevokeResponseErrEnvelope,
]);
export type WsPairingRevokeResponseEnvelope = z.infer<typeof WsPairingRevokeResponseEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — pairing
// ---------------------------------------------------------------------------

export const WsPairingRequestedEventPayload = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingRequestedEventPayload = z.infer<typeof WsPairingRequestedEventPayload>;

export const WsPairingRequestedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.requested"),
  payload: WsPairingRequestedEventPayload,
});
export type WsPairingRequestedEvent = z.infer<typeof WsPairingRequestedEvent>;

export const WsPairingApprovedEventPayload = z
  .object({
    pairing: NodePairingRequest,
    scoped_token: z.string().trim().min(1),
  })
  .strict();
export type WsPairingApprovedEventPayload = z.infer<typeof WsPairingApprovedEventPayload>;

export const WsPairingApprovedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.approved"),
  payload: WsPairingApprovedEventPayload,
});
export type WsPairingApprovedEvent = z.infer<typeof WsPairingApprovedEvent>;

export const WsPairingResolvedEventPayload = z
  .object({
    pairing: NodePairingRequest,
  })
  .strict();
export type WsPairingResolvedEventPayload = z.infer<typeof WsPairingResolvedEventPayload>;

export const WsPairingResolvedEvent = WsEventEnvelope.extend({
  type: z.literal("pairing.resolved"),
  payload: WsPairingResolvedEventPayload,
});
export type WsPairingResolvedEvent = z.infer<typeof WsPairingResolvedEvent>;
