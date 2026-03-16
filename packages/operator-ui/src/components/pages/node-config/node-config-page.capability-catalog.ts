import {
  Camera,
  Globe,
  Link2,
  MapPin,
  Mic,
  Monitor,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { CapabilityCatalogEntry, PlatformKind } from "./node-config-page.types.js";

/**
 * Static catalog of all known capabilities and which platforms support them.
 * The UI renders only the entries whose `platforms` include the current platform.
 */
export const CAPABILITY_CATALOG: readonly CapabilityCatalogEntry[] = [
  // ── Desktop-only ──────────────────────────────────────────────────────────
  {
    key: "desktop",
    label: "Desktop Automation",
    description: "Screenshots, UI queries, mouse and keyboard input for local desktop automation.",
    icon: Monitor,
    platforms: ["desktop"],
  },
  {
    key: "playwright",
    label: "Browser Automation",
    description: "Automated browser navigation, interaction, and page inspection via Playwright.",
    icon: Globe,
    platforms: ["desktop"],
  },
  {
    key: "cli",
    label: "Shell",
    description: "Local command-line execution through the desktop node runtime.",
    icon: Terminal,
    platforms: ["desktop"],
  },
  {
    key: "http",
    label: "Web (HTTP)",
    description: "Outbound HTTP access from the local node runtime.",
    icon: Link2,
    platforms: ["desktop"],
  },

  // ── Shared: Browser + Mobile ──────────────────────────────────────────────
  {
    key: "location",
    label: "Location",
    description: "Expose device geolocation to agents.",
    icon: MapPin,
    platforms: ["browser", "mobile"],
  },
  {
    key: "camera",
    label: "Camera",
    description: "Expose still-photo capture from the device camera.",
    icon: Camera,
    platforms: ["browser", "mobile"],
  },
  {
    key: "audio",
    label: "Audio",
    description: "Expose microphone recording from the device.",
    icon: Mic,
    platforms: ["browser", "mobile"],
  },
] as const;

/** Return catalog entries available for a given platform. */
export function getCapabilitiesForPlatform(
  platform: PlatformKind,
): readonly CapabilityCatalogEntry[] {
  return CAPABILITY_CATALOG.filter((entry) => entry.platforms.includes(platform));
}

/** Look up a catalog entry by key. */
export function getCatalogEntry(key: string): CapabilityCatalogEntry | undefined {
  return CAPABILITY_CATALOG.find((entry) => entry.key === key);
}

// ─── Test action defaults ───────────────────────────────────────────────────

export interface TestActionDefinition {
  label: string;
  actionName: string;
  defaultInput: Record<string, unknown>;
}

/**
 * Static test action definitions per capability key.
 * Adapters use these to construct CapabilityTestAction objects.
 */
export const TEST_ACTION_DEFINITIONS: Readonly<Record<string, readonly TestActionDefinition[]>> = {
  desktop: [
    { label: "Take screenshot", actionName: "screenshot", defaultInput: {} },
    { label: "Capture snapshot", actionName: "snapshot", defaultInput: {} },
  ],
  playwright: [
    {
      label: "Navigate to blank page",
      actionName: "navigate",
      defaultInput: { url: "about:blank" },
    },
  ],
  cli: [
    {
      label: "Run echo test",
      actionName: "execute",
      defaultInput: { command: "echo", args: ["hello from tyrum"] },
    },
  ],
  http: [
    {
      label: "GET httpbin",
      actionName: "fetch",
      defaultInput: { url: "https://httpbin.org/get", method: "GET" },
    },
  ],
  location: [
    {
      label: "Get location",
      actionName: "geolocation.get",
      defaultInput: {
        enable_high_accuracy: false,
        timeout_ms: 30_000,
        maximum_age_ms: 0,
      },
    },
  ],
  camera: [
    {
      label: "Capture photo",
      actionName: "camera.capture_photo",
      defaultInput: { format: "jpeg", quality: 0.92 },
    },
  ],
  audio: [
    {
      label: "Record 3s audio",
      actionName: "microphone.record",
      defaultInput: { duration_ms: 3_000 },
    },
  ],
};

/** Desktop automation sub-action metadata. */
export const DESKTOP_ACTIONS: ReadonlyArray<{
  name: string;
  label: string;
  description: string;
}> = [
  { name: "screenshot", label: "Screenshot", description: "Capture the current screen state." },
  {
    name: "snapshot",
    label: "Snapshot",
    description: "Capture a structured accessibility snapshot.",
  },
  { name: "query", label: "Query", description: "Query UI element properties and state." },
  { name: "act", label: "Act", description: "Perform a high-level UI action." },
  {
    name: "mouse",
    label: "Mouse",
    description: "Send mouse clicks, drags, and scroll events.",
  },
  {
    name: "keyboard",
    label: "Keyboard",
    description: "Send keyboard input and key combinations.",
  },
  {
    name: "wait-for",
    label: "Wait-for",
    description: "Wait for a UI condition before continuing.",
  },
];

/** Icon lookup by capability key (convenience for adapters). */
export function getCapabilityIcon(key: string): LucideIcon {
  return getCatalogEntry(key)?.icon ?? Globe;
}
