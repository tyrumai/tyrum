import { Camera, Globe, Link2, MapPin, Mic, Monitor, Terminal } from "lucide-react";
import type { CapabilityCatalogEntry } from "./node-config-page.types.js";

/**
 * Static catalog of all known capability metadata (label, description, icon).
 * Each platform adapter selects which capabilities to render by key.
 */
export const CAPABILITY_CATALOG: readonly CapabilityCatalogEntry[] = [
  {
    key: "desktop",
    label: "Desktop Automation",
    description: "Screenshots, UI queries, mouse and keyboard input for local desktop automation.",
    icon: Monitor,
  },
  {
    key: "playwright",
    label: "Browser Automation",
    description: "Automated browser navigation, interaction, and page inspection via Playwright.",
    icon: Globe,
  },
  {
    key: "cli",
    label: "Shell",
    description: "Local command-line execution through the desktop node runtime.",
    icon: Terminal,
  },
  {
    key: "http",
    label: "Web (HTTP)",
    description: "Outbound HTTP access from the local node runtime.",
    icon: Link2,
  },
  {
    key: "location",
    label: "Location",
    description: "Expose device geolocation to agents.",
    icon: MapPin,
  },
  {
    key: "camera",
    label: "Camera",
    description: "Expose still-photo capture from the device camera.",
    icon: Camera,
  },
  {
    key: "audio",
    label: "Audio",
    description: "Expose microphone recording from the device.",
    icon: Mic,
  },
] as const;

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
    {
      label: "Capture page snapshot",
      actionName: "snapshot",
      defaultInput: {},
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
      actionName: "get",
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
      actionName: "capture_photo",
      defaultInput: { format: "jpeg", quality: 0.92 },
    },
  ],
  audio: [
    {
      label: "Record 3s audio",
      actionName: "record",
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

/** Browser automation (Playwright) sub-action metadata. */
export const BROWSER_AUTOMATION_ACTIONS: ReadonlyArray<{
  key: string;
  label: string;
  description: string;
}> = [
  { key: "navigate", label: "Navigate", description: "Navigate to a URL." },
  {
    key: "navigate_back",
    label: "Navigate Back",
    description: "Navigate back in browser history.",
  },
  { key: "snapshot", label: "Snapshot", description: "Collect a page accessibility snapshot." },
  { key: "click", label: "Click", description: "Click a page element." },
  { key: "type", label: "Type", description: "Type text into an element." },
  { key: "fill_form", label: "Fill Form", description: "Fill a form field." },
  { key: "select_option", label: "Select Option", description: "Select from a dropdown." },
  { key: "hover", label: "Hover", description: "Hover over an element." },
  { key: "drag", label: "Drag", description: "Drag an element." },
  { key: "press_key", label: "Press Key", description: "Press a keyboard key." },
  { key: "screenshot", label: "Screenshot", description: "Capture a page screenshot." },
  { key: "evaluate", label: "Evaluate", description: "Run JavaScript in page context." },
  { key: "wait_for", label: "Wait For", description: "Wait for a page condition." },
  { key: "tabs", label: "Tabs", description: "List or switch browser tabs." },
  { key: "upload_file", label: "Upload File", description: "Upload a file to a file input." },
  {
    key: "console_messages",
    label: "Console Messages",
    description: "Read browser console output.",
  },
  { key: "network_requests", label: "Network Requests", description: "Inspect network requests." },
  { key: "resize", label: "Resize", description: "Resize the browser viewport." },
  { key: "close", label: "Close", description: "Close the browser." },
  { key: "handle_dialog", label: "Handle Dialog", description: "Accept or dismiss a dialog." },
  { key: "run_code", label: "Run Code", description: "Run arbitrary code in the browser." },
];
