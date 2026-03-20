import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical capability IDs — the 1-tier, platform-agnostic catalog
// ---------------------------------------------------------------------------

/**
 * All recognised capability descriptor IDs following the `tyrum.<type>.<action>`
 * naming convention.  Platform is a property of the *node*, not the capability.
 */
export const CANONICAL_CAPABILITY_IDS = [
  // Cross-platform sensor capabilities
  "tyrum.camera.capture-photo",
  "tyrum.camera.capture-video",
  "tyrum.audio.record",
  "tyrum.location.get",
  // Desktop automation
  "tyrum.desktop.clipboard-write",
  "tyrum.desktop.screenshot",
  "tyrum.desktop.snapshot",
  "tyrum.desktop.query",
  "tyrum.desktop.act",
  "tyrum.desktop.mouse",
  "tyrum.desktop.keyboard",
  "tyrum.desktop.wait-for",
  // Browser automation (matches Playwright MCP tools)
  "tyrum.browser.navigate",
  "tyrum.browser.navigate-back",
  "tyrum.browser.snapshot",
  "tyrum.browser.click",
  "tyrum.browser.type",
  "tyrum.browser.fill-form",
  "tyrum.browser.select-option",
  "tyrum.browser.hover",
  "tyrum.browser.drag",
  "tyrum.browser.press-key",
  "tyrum.browser.screenshot",
  "tyrum.browser.evaluate",
  "tyrum.browser.wait-for",
  "tyrum.browser.tabs",
  "tyrum.browser.upload-file",
  "tyrum.browser.console-messages",
  "tyrum.browser.network-requests",
  "tyrum.browser.resize",
  "tyrum.browser.close",
  "tyrum.browser.handle-dialog",
  "tyrum.browser.run-code",
  "tyrum.browser.launch",
  // Filesystem
  "tyrum.fs.read",
  "tyrum.fs.write",
  "tyrum.fs.edit",
  "tyrum.fs.apply-patch",
  "tyrum.fs.bash",
  "tyrum.fs.glob",
  "tyrum.fs.grep",
] as const;

export type CanonicalCapabilityId = (typeof CANONICAL_CAPABILITY_IDS)[number];

function filterCapabilityIdsByPrefix<Prefix extends string>(
  prefix: Prefix,
): readonly Extract<CanonicalCapabilityId, `${Prefix}${string}`>[] {
  return Object.freeze(
    CANONICAL_CAPABILITY_IDS.filter(
      (id): id is Extract<CanonicalCapabilityId, `${Prefix}${string}`> => id.startsWith(prefix),
    ),
  );
}

/** All canonical browser automation capability IDs. */
export const BROWSER_AUTOMATION_CAPABILITY_IDS = filterCapabilityIdsByPrefix("tyrum.browser.");

/** All canonical filesystem capability IDs. */
export const FILESYSTEM_CAPABILITY_IDS = filterCapabilityIdsByPrefix("tyrum.fs.");

// ---------------------------------------------------------------------------
// Legacy → canonical migration map
// ---------------------------------------------------------------------------

/**
 * Maps deprecated, platform-namespaced capability descriptor IDs to their
 * canonical replacements.  1:1 mappings are a single string; 1:N expansions
 * (e.g. the old monolithic `tyrum.playwright`) are arrays.
 */
export const LEGACY_ID_MIGRATION_MAP: Record<string, string | readonly string[]> = {
  // Mobile (iOS) — collapsed into cross-platform IDs
  "tyrum.ios.location.get-current": "tyrum.location.get",
  "tyrum.ios.camera.capture-photo": "tyrum.camera.capture-photo",
  "tyrum.ios.audio.record-clip": "tyrum.audio.record",
  // Mobile (Android) — collapsed into cross-platform IDs
  "tyrum.android.location.get-current": "tyrum.location.get",
  "tyrum.android.camera.capture-photo": "tyrum.camera.capture-photo",
  "tyrum.android.audio.record-clip": "tyrum.audio.record",
  // Browser node sensors — collapsed into cross-platform IDs
  "tyrum.browser.geolocation.get": "tyrum.location.get",
  "tyrum.browser.camera.capture-photo": "tyrum.camera.capture-photo",
  "tyrum.browser.microphone.record": "tyrum.audio.record",
  // Monolithic playwright → fine-grained browser automation IDs
  "tyrum.playwright": BROWSER_AUTOMATION_CAPABILITY_IDS,
} as const;

/**
 * Returns `true` when `id` is a deprecated capability descriptor ID that
 * should be migrated to canonical form.
 */
export function isLegacyCapabilityDescriptorId(id: string): boolean {
  return id in LEGACY_ID_MIGRATION_MAP;
}

/**
 * Migrates a legacy capability descriptor ID to its canonical replacement(s).
 * Returns `[id]` unchanged when the ID is already canonical.
 */
export function migrateCapabilityDescriptorId(id: string): readonly string[] {
  const mapped = LEGACY_ID_MIGRATION_MAP[id];
  if (mapped === undefined) return [id];
  return typeof mapped === "string" ? [mapped] : mapped;
}

// ---------------------------------------------------------------------------
// Legacy types — kept for backward compatibility during migration
// ---------------------------------------------------------------------------

/**
 * @deprecated Use canonical capability descriptor IDs (`CANONICAL_CAPABILITY_IDS`) instead.
 *
 * Legacy capability kind enum kept for routing and handshake compatibility.
 * Nodes advertise and execute these capabilities; clients do not execute
 * capability calls.
 */
export const ClientCapability = z.enum(["playwright", "ios", "android", "desktop", "browser"]);
export type ClientCapability = z.infer<typeof ClientCapability>;

/** @deprecated Use canonical capability descriptor IDs instead. */
export const CapabilityKind = ClientCapability;
export type CapabilityKind = ClientCapability;

const CAPABILITY_ID_SEGMENT = "[a-z][a-z0-9-]*";
const CAPABILITY_ID_PATTERN = new RegExp(
  `^${CAPABILITY_ID_SEGMENT}(?:\\.${CAPABILITY_ID_SEGMENT})+$`,
);
const CAPABILITY_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const CAPABILITY_DESCRIPTOR_DEFAULT_VERSION = "1.0.0" as const;

/**
 * @deprecated Use `CANONICAL_CAPABILITY_IDS` and `LEGACY_ID_MIGRATION_MAP` instead.
 *
 * Maps legacy `CapabilityKind` values to their descriptor IDs.  These IDs are
 * themselves deprecated where they contain platform prefixes — the migration
 * map rewrites them to canonical form.
 */
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
  browser: [
    "tyrum.browser.geolocation.get",
    "tyrum.browser.camera.capture-photo",
    "tyrum.browser.microphone.record",
  ],
} as const satisfies Record<CapabilityKind, readonly string[]>;

/**
 * @deprecated Legacy umbrella descriptor IDs (`tyrum.ios`, `tyrum.android`, etc.)
 * that expand to their platform-specific splits, which are themselves deprecated.
 */
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

const ADDITIONAL_DESCRIPTOR_TO_LEGACY: Record<string, CapabilityKind> = {
  "tyrum.desktop.clipboard-write": "desktop",
};

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

/**
 * Expands a capability descriptor ID:
 * 1. Legacy umbrella IDs (`tyrum.ios`) → their platform-specific splits
 * 2. Platform-specific splits → canonical IDs via the migration map
 * 3. Already-canonical IDs → returned as-is
 */
export function expandCapabilityDescriptorId(id: string): readonly string[] {
  // First expand umbrella IDs to their legacy splits
  const umbrellaExpanded = LEGACY_UMBRELLA_TO_DESCRIPTOR_IDS[id];
  if (umbrellaExpanded) {
    // Then migrate each legacy split to its canonical form
    return umbrellaExpanded.flatMap((splitId) => migrateCapabilityDescriptorId(splitId));
  }
  // Direct legacy → canonical migration (or pass-through for canonical IDs)
  return migrateCapabilityDescriptorId(id);
}

/**
 * Normalizes an array of capability descriptors by expanding legacy umbrella
 * IDs and migrating platform-namespaced IDs to their canonical form.
 * Deduplicates by ID, keeping the last-seen version for each.
 */
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
  return DESCRIPTOR_TO_LEGACY[id] ?? ADDITIONAL_DESCRIPTOR_TO_LEGACY[id];
}
