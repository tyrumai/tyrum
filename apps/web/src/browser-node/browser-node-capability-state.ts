export type BrowserCapabilityName = "get" | "capture_photo" | "record";

export type BrowserCapabilityState = {
  supported: true;
  enabled: boolean;
  availability_status: "unknown" | "available" | "unavailable";
  unavailable_reason?: string;
};

export type BrowserCapabilitySettings = Record<BrowserCapabilityName, boolean>;

export const BROWSER_CAPABILITY_NAMES: BrowserCapabilityName[] = ["get", "capture_photo", "record"];
const BROWSER_CAPABILITY_DESCRIPTOR_IDS: Record<BrowserCapabilityName, string> = {
  get: "tyrum.location.get",
  capture_photo: "tyrum.camera.capture-photo",
  record: "tyrum.audio.record",
};

const ENABLED_STORAGE_KEY = "tyrum.operator-ui.browserNode.enabled";
const CAPABILITY_SETTINGS_STORAGE_KEY = "tyrum.operator-ui.browserNode.capabilities";

const DEFAULT_CAPABILITY_SETTINGS: BrowserCapabilitySettings = {
  get: true,
  capture_photo: true,
  record: true,
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
      get: typeof parsed["get"] === "boolean" ? parsed["get"] : DEFAULT_CAPABILITY_SETTINGS["get"],
      capture_photo:
        typeof parsed["capture_photo"] === "boolean"
          ? parsed["capture_photo"]
          : DEFAULT_CAPABILITY_SETTINGS["capture_photo"],
      record:
        typeof parsed["record"] === "boolean"
          ? parsed["record"]
          : DEFAULT_CAPABILITY_SETTINGS["record"],
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
    get: {
      supported: true,
      enabled: settings["get"],
      availability_status: geolocationAvailable ? "available" : "unavailable",
      ...(geolocationAvailable
        ? undefined
        : { unavailable_reason: "Geolocation requires a secure context and browser support." }),
    },
    capture_photo: {
      supported: true,
      enabled: settings["capture_photo"],
      availability_status: canUseMediaDevices ? "unknown" : "unavailable",
      ...(canUseMediaDevices
        ? undefined
        : {
            unavailable_reason:
              "Camera capture requires a secure context and mediaDevices.getUserMedia.",
          }),
    },
    record: {
      supported: true,
      enabled: settings["record"],
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

function toNodeCapabilityActionState(name: BrowserCapabilityName, state: BrowserCapabilityState) {
  return {
    name,
    enabled: state.enabled,
    availability_status: state.availability_status,
    ...(state.unavailable_reason ? { unavailable_reason: state.unavailable_reason } : {}),
  };
}

export function toNodeCapabilityStates(
  capabilityStates: Record<BrowserCapabilityName, BrowserCapabilityState>,
) {
  return BROWSER_CAPABILITY_NAMES.map((name) => ({
    capability: {
      id: BROWSER_CAPABILITY_DESCRIPTOR_IDS[name],
      version: "1.0.0",
    },
    actions: [toNodeCapabilityActionState(name, capabilityStates[name])],
  }));
}
