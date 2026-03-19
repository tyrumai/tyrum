import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { NodeId } from "./keys.js";
import { CapabilityDescriptor } from "./capability.js";
import { NodeCapabilitySummary } from "./node-capability.js";
import { ReviewEntry } from "./review.js";
import { DevicePlatform, DeviceType } from "./protocol/connect.js";

export const NodeIdentity = z
  .object({
    node_id: NodeId,
    label: z.string().trim().min(1).optional(),
    capabilities: z.array(CapabilityDescriptor).default([]),
    last_seen_at: DateTimeSchema,
    metadata: z.unknown().optional(),
  })
  .strict();
export type NodeIdentity = z.infer<typeof NodeIdentity>;

export const NodePairingStatus = z.enum([
  "queued",
  "reviewing",
  "awaiting_human",
  "approved",
  "denied",
  "revoked",
]);
export type NodePairingStatus = z.infer<typeof NodePairingStatus>;

export const NodePairingDecision = z.enum(["approved", "denied", "revoked"]);
export type NodePairingDecision = z.infer<typeof NodePairingDecision>;

export const NodePairingTrustLevel = z.enum(["local", "remote"]);
export type NodePairingTrustLevel = z.infer<typeof NodePairingTrustLevel>;

export const NodePairingRequest = z
  .object({
    pairing_id: z.number().int().positive(),
    status: NodePairingStatus,
    motivation: z.string().trim().min(1),
    trust_level: NodePairingTrustLevel.optional(),
    requested_at: DateTimeSchema,
    node: NodeIdentity,
    capability_allowlist: z.array(CapabilityDescriptor).default([]),
    latest_review: ReviewEntry.nullable(),
    reviews: z.array(ReviewEntry).optional(),
  })
  .strict();
export type NodePairingRequest = z.infer<typeof NodePairingRequest>;

export const NodeInventoryEntry = z
  .object({
    node_id: NodeId,
    label: z.string().trim().min(1).optional(),
    mode: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    connected: z.boolean(),
    paired_status: NodePairingStatus.nullable(),
    attached_to_requested_lane: z.boolean(),
    source_client_device_id: z.string().trim().min(1).nullable().optional(),
    last_seen_at: DateTimeSchema.optional(),
    capabilities: z.array(NodeCapabilitySummary),
    device: z
      .object({
        type: DeviceType.optional(),
        platform: DevicePlatform.optional(),
        model: z.string().trim().min(1).optional(),
      })
      .optional(),
    last_tyrum_interaction_at: DateTimeSchema.optional(),
  })
  .strict();
export type NodeInventoryEntry = z.infer<typeof NodeInventoryEntry>;

export const NodeInventoryResponse = z
  .object({
    status: z.literal("ok"),
    generated_at: DateTimeSchema,
    key: z.string().trim().min(1).optional(),
    lane: z.string().trim().min(1).optional(),
    nodes: z.array(NodeInventoryEntry),
  })
  .strict();
export type NodeInventoryResponse = z.infer<typeof NodeInventoryResponse>;
