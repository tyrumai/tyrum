import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { NodeId } from "./keys.js";
import { CapabilityDescriptor, CapabilityKind } from "./capability.js";

export const NodeIdentity = z
  .object({
    node_id: NodeId,
    label: z.string().trim().min(1).optional(),
    capabilities: z.array(CapabilityKind).default([]),
    last_seen_at: DateTimeSchema,
    metadata: z.unknown().optional(),
  })
  .strict();
export type NodeIdentity = z.infer<typeof NodeIdentity>;

export const NodePairingStatus = z.enum(["pending", "approved", "denied", "revoked"]);
export type NodePairingStatus = z.infer<typeof NodePairingStatus>;

export const NodePairingDecision = z.enum(["approved", "denied", "revoked"]);
export type NodePairingDecision = z.infer<typeof NodePairingDecision>;

export const NodePairingTrustLevel = z.enum(["local", "remote"]);
export type NodePairingTrustLevel = z.infer<typeof NodePairingTrustLevel>;

export const NodePairingResolution = z
  .object({
    decision: NodePairingDecision,
    resolved_at: DateTimeSchema,
    reason: z.string().optional(),
    resolved_by: z.unknown().optional(),
  })
  .strict();
export type NodePairingResolution = z.infer<typeof NodePairingResolution>;

export const NodePairingRequest = z
  .object({
    pairing_id: z.number().int().positive(),
    status: NodePairingStatus,
    trust_level: NodePairingTrustLevel.optional(),
    requested_at: DateTimeSchema,
    node: NodeIdentity,
    capability_allowlist: z.array(CapabilityDescriptor).default([]),
    resolution: NodePairingResolution.nullable(),
    resolved_at: DateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasResolution = value.resolution !== null;
    if (value.status === "pending" && hasResolution) {
      ctx.addIssue({
        code: "custom",
        message: "pending pairing requests must have resolution: null",
        path: ["resolution"],
      });
    }
    if (value.status !== "pending" && !hasResolution) {
      ctx.addIssue({
        code: "custom",
        message: "non-pending pairing requests must include a resolution",
        path: ["resolution"],
      });
    }
  });
export type NodePairingRequest = z.infer<typeof NodePairingRequest>;
