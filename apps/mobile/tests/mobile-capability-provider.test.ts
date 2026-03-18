// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { IosActionResult } from "@tyrum/schemas";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

const { cameraGetPhoto, cameraRequestPermissions, getCurrentPosition, requestPermissions } =
  vi.hoisted(() => ({
    cameraGetPhoto: vi.fn(),
    cameraRequestPermissions: vi.fn(),
    requestPermissions: vi.fn(async () => ({ location: "granted" })),
    getCurrentPosition: vi.fn(async () => ({
      coords: {
        latitude: 52.3676,
        longitude: 4.9041,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.parse("2026-03-11T12:00:00.000Z"),
    })),
  }));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    requestPermissions,
    getCurrentPosition,
  },
}));

vi.mock("@capacitor/camera", () => ({
  Camera: {
    requestPermissions: cameraRequestPermissions,
    getPhoto: cameraGetPhoto,
  },
  CameraDirection: { Front: "FRONT", Rear: "REAR" },
  CameraResultType: { Base64: "base64" },
  CameraSource: { Camera: "camera" },
}));

describe("createMobileCapabilityProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps native geolocation coords to the mobile schema field names", async () => {
    const { createMobileCapabilityProvider } = await import("../src/mobile-capability-provider.js");
    const provider = createMobileCapabilityProvider("ios");

    const result = await provider.execute({
      type: "IOS",
      args: { op: "get" },
    });

    expect(result.success).toBe(true);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: false,
      timeout: 30_000,
      maximumAge: 0,
    });
    expect(IosActionResult.parse(result.evidence)).toEqual({
      op: "get",
      coords: {
        latitude: 52.3676,
        longitude: 4.9041,
        accuracy_m: 12,
        altitude_m: null,
        altitude_accuracy_m: null,
        heading_deg: null,
        speed_mps: null,
      },
      timestamp: "2026-03-11T12:00:00.000Z",
    });
  });

  it("omits image dimensions when they cannot be measured", async () => {
    const previousImage = globalThis.Image;
    // Simulate environments where Image is unavailable inside the webview.
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: undefined,
    });
    cameraGetPhoto.mockResolvedValue({
      base64String: "ZmFrZS1pbWFnZQ==",
      format: "jpeg",
    });

    try {
      const { createMobileCapabilityProvider } =
        await import("../src/mobile-capability-provider.js");
      const provider = createMobileCapabilityProvider("ios");

      const result = await provider.execute({
        type: "IOS",
        args: { op: "capture_photo", format: "jpeg" },
      });

      expect(result.success).toBe(true);
      expect(cameraRequestPermissions).toHaveBeenCalledWith({ permissions: ["camera"] });
      expect(IosActionResult.parse(result.evidence)).toMatchObject({
        op: "capture_photo",
        bytesBase64: "ZmFrZS1pbWFnZQ==",
        mime: "image/jpeg",
      });
      expect(result.evidence).not.toHaveProperty("width");
      expect(result.evidence).not.toHaveProperty("height");
    } finally {
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: previousImage,
      });
    }
  });
});
