import { z } from "zod";

/**
 * Legacy capability kind enum kept for routing and handshake compatibility.
 *
 * Nodes advertise and execute these capabilities; clients do not execute
 * capability calls.
 */
export const ClientCapability = z.enum([
  "playwright",
  "ios",
  "android",
  "desktop",
  "cli",
  "http",
  "browser",
]);
export type ClientCapability = z.infer<typeof ClientCapability>;

/** Preferred alias for the legacy `ClientCapability` enum. */
export const CapabilityKind = ClientCapability;
export type CapabilityKind = ClientCapability;

const CAPABILITY_ID_SEGMENT = "[a-z][a-z0-9-]*";
const CAPABILITY_ID_PATTERN = new RegExp(
  `^${CAPABILITY_ID_SEGMENT}(?:\\.${CAPABILITY_ID_SEGMENT})+$`,
);
const CAPABILITY_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const CAPABILITY_DESCRIPTOR_DEFAULT_VERSION = "1.0.0" as const;

export const CapabilityDescriptorId = z
  .string()
  .trim()
  .min(3)
  .regex(CAPABILITY_ID_PATTERN, "capability IDs must be namespaced (example: system.shell.exec)");

export const CapabilityDescriptorVersion = z
  .string()
  .trim()
  .regex(
    CAPABILITY_VERSION_PATTERN,
    "capability versions must use semantic version format (x.y.z)",
  );

const LEGACY_TO_DESCRIPTOR_ID = {
  playwright: "tyrum.playwright",
  ios: "tyrum.ios",
  android: "tyrum.android",
  desktop: "tyrum.desktop",
  cli: "tyrum.cli",
  http: "tyrum.http",
  browser: "tyrum.browser",
} as const;

type LegacyCapabilityDescriptorId = (typeof LEGACY_TO_DESCRIPTOR_ID)[CapabilityKind];

const DESCRIPTOR_TO_LEGACY = Object.fromEntries(
  (
    Object.entries(LEGACY_TO_DESCRIPTOR_ID) as Array<[CapabilityKind, LegacyCapabilityDescriptorId]>
  ).map(([capability, id]) => [id, capability]),
) as Record<LegacyCapabilityDescriptorId, CapabilityKind>;

/**
 * Capability descriptor used in the vNext handshake.
 *
 * Descriptors are namespaced and explicitly versioned so nodes can advertise
 * stable contracts independently from legacy capability-kind routing keys.
 */
export const CapabilityDescriptor = z
  .object({
    id: CapabilityDescriptorId,
    version: CapabilityDescriptorVersion.default(CAPABILITY_DESCRIPTOR_DEFAULT_VERSION),
  })
  .strict();
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptor>;

export function descriptorIdForClientCapability(
  capability: CapabilityKind,
): LegacyCapabilityDescriptorId {
  return LEGACY_TO_DESCRIPTOR_ID[capability];
}

export function clientCapabilityFromDescriptorId(id: string): CapabilityKind | undefined {
  return DESCRIPTOR_TO_LEGACY[id as LegacyCapabilityDescriptorId];
}
