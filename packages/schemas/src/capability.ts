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

export const CAPABILITY_DESCRIPTOR_IDS = {
  playwright: ["tyrum.playwright"],
  ios: [
    "tyrum.ios.location.get-current",
    "tyrum.ios.camera.capture-photo",
    "tyrum.ios.audio.record-clip",
  ],
  android: [
    "tyrum.android.location.get-current",
    "tyrum.android.camera.capture-photo",
    "tyrum.android.audio.record-clip",
  ],
  desktop: [
    "tyrum.desktop.screenshot",
    "tyrum.desktop.snapshot",
    "tyrum.desktop.query",
    "tyrum.desktop.act",
    "tyrum.desktop.mouse",
    "tyrum.desktop.keyboard",
    "tyrum.desktop.wait-for",
  ],
  cli: ["tyrum.cli"],
  http: ["tyrum.http"],
  browser: [
    "tyrum.browser.geolocation.get",
    "tyrum.browser.camera.capture-photo",
    "tyrum.browser.microphone.record",
  ],
} as const satisfies Record<CapabilityKind, readonly string[]>;

export const LEGACY_UMBRELLA_PLATFORM_DESCRIPTOR_IDS = {
  ios: "tyrum.ios",
  android: "tyrum.android",
  desktop: "tyrum.desktop",
  browser: "tyrum.browser",
} as const satisfies Partial<Record<CapabilityKind, string>>;

const LEGACY_UMBRELLA_TO_DESCRIPTOR_IDS = Object.fromEntries(
  (Object.entries(LEGACY_UMBRELLA_PLATFORM_DESCRIPTOR_IDS) as Array<[CapabilityKind, string]>).map(
    ([capability, legacyId]) => [legacyId, CAPABILITY_DESCRIPTOR_IDS[capability]],
  ),
) as Record<string, readonly string[]>;

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

const DESCRIPTOR_TO_LEGACY = Object.fromEntries(
  (Object.entries(CAPABILITY_DESCRIPTOR_IDS) as Array<[CapabilityKind, readonly string[]]>).flatMap(
    ([capability, ids]) => ids.map((id) => [id, capability] as const),
  ),
) as Record<string, CapabilityKind>;

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

export function descriptorIdsForClientCapability(capability: CapabilityKind): readonly string[] {
  return CAPABILITY_DESCRIPTOR_IDS[capability];
}

export function capabilityDescriptorsForClientCapability(
  capability: CapabilityKind,
  version = CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
): CapabilityDescriptor[] {
  return descriptorIdsForClientCapability(capability).map((id) => ({ id, version }));
}

export function descriptorIdForClientCapability(capability: CapabilityKind): string {
  const descriptorIds = descriptorIdsForClientCapability(capability);
  if (descriptorIds.length !== 1) {
    throw new Error(
      `capability '${capability}' expands to multiple descriptor IDs; use descriptorIdsForClientCapability instead`,
    );
  }
  return descriptorIds[0]!;
}

export function isLegacyUmbrellaCapabilityDescriptorId(id: string): boolean {
  return (Object.values(LEGACY_UMBRELLA_PLATFORM_DESCRIPTOR_IDS) as readonly string[]).includes(id);
}

export function expandCapabilityDescriptorId(id: string): readonly string[] {
  return LEGACY_UMBRELLA_TO_DESCRIPTOR_IDS[id] ?? [id];
}

export function normalizeCapabilityDescriptors(
  descriptors: readonly CapabilityDescriptor[],
): CapabilityDescriptor[] {
  const normalized = new Map<string, CapabilityDescriptor>();
  for (const descriptor of descriptors) {
    const expandedIds = expandCapabilityDescriptorId(descriptor.id);
    for (const id of expandedIds) {
      normalized.set(id, { id, version: descriptor.version });
    }
  }
  return [...normalized.values()];
}

export function clientCapabilityFromDescriptorId(id: string): CapabilityKind | undefined {
  if (id in LEGACY_UMBRELLA_TO_DESCRIPTOR_IDS) {
    return Object.entries(LEGACY_UMBRELLA_PLATFORM_DESCRIPTOR_IDS).find(
      ([, legacyId]) => legacyId === id,
    )?.[0] as CapabilityKind | undefined;
  }
  return DESCRIPTOR_TO_LEGACY[id];
}
