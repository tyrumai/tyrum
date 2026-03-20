import { BROWSER_CAPABILITY_CATALOG_ENTRIES } from "./capability-catalog-browser.js";
import { DESKTOP_CAPABILITY_CATALOG_ENTRIES } from "./capability-catalog-desktop.js";
import { FILESYSTEM_CAPABILITY_CATALOG_ENTRIES } from "./capability-catalog-filesystem.js";
import { type CapabilityCatalogEntry, type CatalogAction } from "./capability-catalog-helpers.js";
import { SENSOR_CAPABILITY_CATALOG_ENTRIES } from "./capability-catalog-sensors.js";

export type { CapabilityCatalogEntry } from "./capability-catalog-helpers.js";

const CATALOG_ENTRIES: readonly CapabilityCatalogEntry[] = [
  ...DESKTOP_CAPABILITY_CATALOG_ENTRIES,
  ...SENSOR_CAPABILITY_CATALOG_ENTRIES,
  ...BROWSER_CAPABILITY_CATALOG_ENTRIES,
  ...FILESYSTEM_CAPABILITY_CATALOG_ENTRIES,
];

const CATALOG = new Map<string, CapabilityCatalogEntry>(
  CATALOG_ENTRIES.map((entry) => [entry.descriptor.id, entry] as const),
);

export function listCapabilityCatalogEntries(): readonly CapabilityCatalogEntry[] {
  return CATALOG_ENTRIES;
}

export function getCapabilityCatalogEntry(
  capabilityId: string,
): CapabilityCatalogEntry | undefined {
  return CATALOG.get(capabilityId);
}

export function getCapabilityCatalogAction(
  capabilityId: string,
  actionName: string,
): CatalogAction | undefined {
  return CATALOG.get(capabilityId)?.actions.find((action) => action.name === actionName);
}
