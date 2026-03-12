import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  type NodeCapabilityActionState,
  type NodeCapabilityState,
} from "@tyrum/schemas";

export type BrowserCapabilityName =
  | "geolocation.get"
  | "camera.capture_photo"
  | "microphone.record";

export type BrowserCapabilityState = {
  supported: true;
  enabled: boolean;
  availability_status: "unknown" | "available" | "unavailable";
  unavailable_reason?: string;
};

export type BrowserCapabilitySettings = Record<BrowserCapabilityName, boolean>;

export const BROWSER_CAPABILITY_NAMES: BrowserCapabilityName[] = [
  "geolocation.get",
  "camera.capture_photo",
  "microphone.record",
];

const BROWSER_CAPABILITY_DESCRIPTOR_IDS: Record<BrowserCapabilityName, string> = {
  "geolocation.get": "tyrum.browser.geolocation.get",
  "camera.capture_photo": "tyrum.browser.camera.capture-photo",
  "microphone.record": "tyrum.browser.microphone.record",
};

const ENABLED_STORAGE_KEY = "tyrum.operator-ui.browserNode.enabled";
const CAPABILITY_SETTINGS_STORAGE_KEY = "tyrum.operator-ui.browserNode.capabilities";

const DEFAULT_CAPABILITY_SETTINGS: BrowserCapabilitySettings = {
  "geolocation.get": true,
  "camera.capture_photo": true,
  "microphone.record": true,
};

export function readEnabledFromStorage(): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== "function") return false;
    return storage.getItem(ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeEnabledToStorage(enabled: boolean): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (enabled) {
      if (typeof storage.setItem === "function") {
        storage.setItem(ENABLED_STORAGE_KEY, "1");
      }
      return;
    }
    if (typeof storage.removeItem === "function") {
      storage.removeItem(ENABLED_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function readCapabilitySettingsFromStorage(): BrowserCapabilitySettings {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== "function") return DEFAULT_CAPABILITY_SETTINGS;
    const raw = storage.getItem(CAPABILITY_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CAPABILITY_SETTINGS;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      "geolocation.get":
        typeof parsed["geolocation.get"] === "boolean"
          ? parsed["geolocation.get"]
          : DEFAULT_CAPABILITY_SETTINGS["geolocation.get"],
      "camera.capture_photo":
        typeof parsed["camera.capture_photo"] === "boolean"
          ? parsed["camera.capture_photo"]
          : DEFAULT_CAPABILITY_SETTINGS["camera.capture_photo"],
      "microphone.record":
        typeof parsed["microphone.record"] === "boolean"
          ? parsed["microphone.record"]
          : DEFAULT_CAPABILITY_SETTINGS["microphone.record"],
    };
  } catch {
    return DEFAULT_CAPABILITY_SETTINGS;
  }
}

export function writeCapabilitySettingsToStorage(settings: BrowserCapabilitySettings): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.setItem !== "function") return;
    storage.setItem(CAPABILITY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function resolveBrowserCapabilityStates(
  settings: BrowserCapabilitySettings,
): Record<BrowserCapabilityName, BrowserCapabilityState> {
  const geolocationAvailable = globalThis.isSecureContext && !!globalThis.navigator?.geolocation;
  const mediaDevices = globalThis.navigator?.mediaDevices;
  const canUseMediaDevices = globalThis.isSecureContext && !!mediaDevices?.getUserMedia;
  const hasMediaRecorder = typeof globalThis.MediaRecorder === "function";

  return {
    "geolocation.get": {
      supported: true,
      enabled: settings["geolocation.get"],
      availability_status: geolocationAvailable ? "available" : "unavailable",
      ...(geolocationAvailable
        ? undefined
        : { unavailable_reason: "Geolocation requires a secure context and browser support." }),
    },
    "camera.capture_photo": {
      supported: true,
      enabled: settings["camera.capture_photo"],
      availability_status: canUseMediaDevices ? "unknown" : "unavailable",
      ...(canUseMediaDevices
        ? undefined
        : {
            unavailable_reason:
              "Camera capture requires a secure context and mediaDevices.getUserMedia.",
          }),
    },
    "microphone.record": {
      supported: true,
      enabled: settings["microphone.record"],
      availability_status: canUseMediaDevices && hasMediaRecorder ? "unknown" : "unavailable",
      ...(canUseMediaDevices && hasMediaRecorder
        ? undefined
        : {
            unavailable_reason:
              "Microphone recording requires a secure context, mediaDevices.getUserMedia, and MediaRecorder.",
          }),
    },
  };
}

function toNodeCapabilityActionState(
  name: BrowserCapabilityName,
  state: BrowserCapabilityState,
): NodeCapabilityActionState {
  const actionState: NodeCapabilityActionState = {
    name,
    enabled: state.enabled,
    availability_status: state.availability_status,
  };
  if (state.unavailable_reason) {
    actionState.unavailable_reason = state.unavailable_reason;
  }
  return actionState;
}

export function toNodeCapabilityStates(
  capabilityStates: Record<BrowserCapabilityName, BrowserCapabilityState>,
): NodeCapabilityState[] {
  return BROWSER_CAPABILITY_NAMES.map((name) => ({
    capability: {
      id: BROWSER_CAPABILITY_DESCRIPTOR_IDS[name],
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    },
    actions: [toNodeCapabilityActionState(name, capabilityStates[name])],
  }));
}
