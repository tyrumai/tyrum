import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  type NodeCapabilityActionState,
  type NodeCapabilityState,
} from "@tyrum/contracts";
import { Capacitor } from "@capacitor/core";
import type {
  MobileHostActionName,
  MobileHostActionState,
  MobileHostPlatform,
  MobileHostState,
} from "@tyrum/operator-ui";
import type { MobileActionSettings } from "./mobile-config.js";

export const MOBILE_ACTION_NAMES: MobileHostActionName[] = ["get", "capture_photo", "record"];

const MOBILE_CAPABILITY_DESCRIPTOR_IDS: Record<MobileHostActionName, string> = {
  get: "tyrum.location.get",
  capture_photo: "tyrum.camera.capture-photo",
  record: "tyrum.audio.record",
};

export function resolveMobilePlatform(): MobileHostPlatform {
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

export function resolveMobileActionStates(
  settings: MobileActionSettings,
): Record<MobileHostActionName, MobileHostActionState> {
  const hasGeolocation =
    Capacitor.isNativePlatform() || typeof globalThis.navigator?.geolocation !== "undefined";
  const hasCamera = Capacitor.isNativePlatform() || typeof globalThis.document !== "undefined";
  const hasAudio =
    typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function" &&
    typeof globalThis.MediaRecorder === "function";

  return {
    get: {
      enabled: settings["get"],
      availabilityStatus: hasGeolocation ? "ready" : "unavailable",
      unavailableReason: hasGeolocation
        ? null
        : "Location services are unavailable in this runtime.",
    },
    capture_photo: {
      enabled: settings["capture_photo"],
      availabilityStatus: hasCamera ? "ready" : "unavailable",
      unavailableReason: hasCamera ? null : "Camera capture is unavailable in this runtime.",
    },
    record: {
      enabled: settings["record"],
      availabilityStatus: hasAudio ? "ready" : "unavailable",
      unavailableReason: hasAudio
        ? null
        : "Microphone recording requires mediaDevices.getUserMedia and MediaRecorder.",
    },
  };
}

function toNodeActionState(
  name: MobileHostActionName,
  state: MobileHostActionState,
): NodeCapabilityActionState {
  return {
    name,
    enabled: state.enabled,
    availability_status: state.availabilityStatus === "ready" ? "available" : "unavailable",
    ...(state.unavailableReason ? { unavailable_reason: state.unavailableReason } : {}),
  };
}

export function toNodeCapabilityStates(
  actions: Record<MobileHostActionName, MobileHostActionState>,
): NodeCapabilityState[] {
  return MOBILE_ACTION_NAMES.map((name) => ({
    capability: {
      id: MOBILE_CAPABILITY_DESCRIPTOR_IDS[name],
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    },
    actions: [toNodeActionState(name, actions[name])],
  }));
}

export function buildMobileHostState(input: {
  platform: MobileHostPlatform;
  enabled: boolean;
  status: MobileHostState["status"];
  deviceId: string | null;
  error?: string | null;
  actions: Record<MobileHostActionName, MobileHostActionState>;
}): MobileHostState {
  return {
    platform: input.platform,
    enabled: input.enabled,
    status: input.status,
    deviceId: input.deviceId,
    error: input.error ?? null,
    actions: input.actions,
  };
}
