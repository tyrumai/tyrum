// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCapabilitySettingsFromStorage,
  readEnabledFromStorage,
  resolveBrowserCapabilityStates,
  toNodeCapabilityStates,
  writeCapabilitySettingsToStorage,
  writeEnabledToStorage,
} from "../src/browser-node/browser-node-capability-state.js";

function stubLocalStorage(storage: Partial<Storage> | undefined): void {
  vi.stubGlobal("localStorage", storage);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser node capability state", () => {
  it("falls back safely when storage is unavailable or malformed", () => {
    stubLocalStorage(undefined);
    expect(readEnabledFromStorage()).toBe(false);
    expect(readCapabilitySettingsFromStorage()).toEqual({
      get: true,
      capture_photo: true,
      record: true,
    });

    stubLocalStorage({
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    });
    expect(readEnabledFromStorage()).toBe(false);
    expect(readCapabilitySettingsFromStorage()).toEqual({
      get: true,
      capture_photo: true,
      record: true,
    });

    stubLocalStorage({
      getItem: vi.fn(() => "{not-json"),
    });
    expect(readCapabilitySettingsFromStorage()).toEqual({
      get: true,
      capture_photo: true,
      record: true,
    });
  });

  it("persists enabled state and capability settings when storage supports it", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    stubLocalStorage({
      setItem,
      removeItem,
      getItem: vi.fn((key: string) => {
        if (key === "tyrum.operator-ui.browserNode.enabled") {
          return "1";
        }
        if (key === "tyrum.operator-ui.browserNode.capabilities") {
          return JSON.stringify({
            get: false,
            capture_photo: true,
          });
        }
        return null;
      }),
    });

    expect(readEnabledFromStorage()).toBe(true);
    expect(readCapabilitySettingsFromStorage()).toEqual({
      get: false,
      capture_photo: true,
      record: true,
    });

    writeEnabledToStorage(true);
    writeEnabledToStorage(false);
    writeCapabilitySettingsToStorage({
      get: false,
      capture_photo: false,
      record: true,
    });

    expect(setItem).toHaveBeenCalledWith("tyrum.operator-ui.browserNode.enabled", "1");
    expect(removeItem).toHaveBeenCalledWith("tyrum.operator-ui.browserNode.enabled");
    expect(setItem).toHaveBeenCalledWith(
      "tyrum.operator-ui.browserNode.capabilities",
      JSON.stringify({
        get: false,
        capture_photo: false,
        record: true,
      }),
    );
  });

  it("ignores storage writes when storage methods are missing or throw", () => {
    stubLocalStorage({});
    expect(() => {
      writeEnabledToStorage(true);
      writeEnabledToStorage(false);
      writeCapabilitySettingsToStorage({
        get: true,
        capture_photo: true,
        record: true,
      });
    }).not.toThrow();

    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    const removeItem = vi.fn(() => {
      throw new Error("quota");
    });
    stubLocalStorage({ setItem, removeItem });

    expect(() => {
      writeEnabledToStorage(true);
      writeEnabledToStorage(false);
      writeCapabilitySettingsToStorage({
        get: true,
        capture_photo: false,
        record: false,
      });
    }).not.toThrow();
  });

  it("resolves browser capability availability across supported and unsupported environments", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("navigator", {});

    const unavailable = resolveBrowserCapabilityStates({
      get: true,
      capture_photo: false,
      record: true,
    });

    expect(unavailable.get).toMatchObject({
      enabled: true,
      availability_status: "unavailable",
      unavailable_reason: "Geolocation requires a secure context and browser support.",
    });
    expect(unavailable.capture_photo).toMatchObject({
      enabled: false,
      availability_status: "unavailable",
      unavailable_reason: "Camera capture requires a secure context and mediaDevices.getUserMedia.",
    });
    expect(unavailable.record).toMatchObject({
      enabled: true,
      availability_status: "unavailable",
      unavailable_reason:
        "Microphone recording requires a secure context, mediaDevices.getUserMedia, and MediaRecorder.",
    });

    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      geolocation: {},
      mediaDevices: {
        getUserMedia: vi.fn(),
      },
    });
    vi.stubGlobal(
      "MediaRecorder",
      Object.assign(function MediaRecorderStub() {}, {
        isTypeSupported: () => true,
      }),
    );

    const available = resolveBrowserCapabilityStates({
      get: false,
      capture_photo: true,
      record: false,
    });

    expect(available.get).toMatchObject({
      enabled: false,
      availability_status: "available",
    });
    expect(available.get.unavailable_reason).toBeUndefined();
    expect(available.capture_photo).toMatchObject({
      enabled: true,
      availability_status: "unknown",
    });
    expect(available.capture_photo.unavailable_reason).toBeUndefined();
    expect(available.record).toMatchObject({
      enabled: false,
      availability_status: "unknown",
    });
    expect(available.record.unavailable_reason).toBeUndefined();
  });

  it("converts capability states into node capability payloads without duplicating reasons", () => {
    const payload = toNodeCapabilityStates({
      get: {
        supported: true,
        enabled: true,
        availability_status: "available",
      },
      capture_photo: {
        supported: true,
        enabled: false,
        availability_status: "unavailable",
        unavailable_reason: "camera blocked",
      },
      record: {
        supported: true,
        enabled: true,
        availability_status: "unknown",
      },
    });

    expect(payload).toEqual([
      {
        capability: { id: "tyrum.location.get", version: "1.0.0" },
        actions: [
          {
            name: "get",
            enabled: true,
            availability_status: "available",
          },
        ],
      },
      {
        capability: { id: "tyrum.camera.capture-photo", version: "1.0.0" },
        actions: [
          {
            name: "capture_photo",
            enabled: false,
            availability_status: "unavailable",
            unavailable_reason: "camera blocked",
          },
        ],
      },
      {
        capability: { id: "tyrum.audio.record", version: "1.0.0" },
        actions: [
          {
            name: "record",
            enabled: true,
            availability_status: "unknown",
          },
        ],
      },
    ]);
  });
});
