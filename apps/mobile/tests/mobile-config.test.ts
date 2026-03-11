// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const secureState = new Map<string, unknown>();
const preferenceState = new Map<string, string>();

vi.mock(
  "@aparajita/capacitor-secure-storage",
  () => ({
    SecureStorage: {
      get: vi.fn(async (key: string) => secureState.get(key) ?? null),
      getItem: vi.fn(async (key: string) => {
        const value = secureState.get(key);
        return typeof value === "string" ? value : null;
      }),
      set: vi.fn(async (key: string, value: unknown) => {
        secureState.set(key, value);
      }),
      setItem: vi.fn(async (key: string, value: string) => {
        secureState.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        secureState.delete(key);
      }),
      setKeyPrefix: vi.fn(async () => {}),
    },
  }),
  { virtual: true },
);

vi.mock(
  "@capacitor/preferences",
  () => ({
    Preferences: {
      configure: vi.fn(async () => {}),
      get: vi.fn(async ({ key }: { key: string }) => ({ value: preferenceState.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        preferenceState.set(key, value);
      }),
      remove: vi.fn(async ({ key }: { key: string }) => {
        preferenceState.delete(key);
      }),
    },
  }),
  { virtual: true },
);

describe("mobile-config", () => {
  beforeEach(() => {
    secureState.clear();
    preferenceState.clear();
    vi.resetModules();
  });

  it("loads legacy configs with default location streaming settings", async () => {
    preferenceState.set(
      "mobile.config",
      JSON.stringify({
        httpBaseUrl: "https://gateway.example/",
        wsUrl: "wss://gateway.example/ws",
        nodeEnabled: true,
        actionSettings: {
          "location.get_current": true,
          "camera.capture_photo": true,
          "audio.record_clip": true,
        },
      }),
    );
    secureState.set("gateway.token", "token-1");

    const { loadMobileBootstrapConfig } = await import("../src/mobile-config.js");
    await expect(loadMobileBootstrapConfig()).resolves.toEqual({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-1",
      nodeEnabled: true,
      actionSettings: {
        "location.get_current": true,
        "camera.capture_photo": true,
        "audio.record_clip": true,
      },
      locationStreaming: {
        streamEnabled: true,
        distanceFilterM: 100,
        maxIntervalMs: 900_000,
        maxAccuracyM: 100,
        backgroundEnabled: true,
      },
    });
  });

  it("persists location streaming config updates", async () => {
    const { saveMobileBootstrapConfig, updateMobileConnectionConfig } =
      await import("../src/mobile-config.js");

    const current = {
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-1",
      nodeEnabled: true,
      actionSettings: {
        "location.get_current": true,
        "camera.capture_photo": true,
        "audio.record_clip": true,
      },
      locationStreaming: {
        streamEnabled: true,
        distanceFilterM: 100,
        maxIntervalMs: 900_000,
        maxAccuracyM: 100,
        backgroundEnabled: true,
      },
    };

    await saveMobileBootstrapConfig(current);
    const updated = await updateMobileConnectionConfig(current, {
      locationStreaming: {
        streamEnabled: false,
        distanceFilterM: 250,
        maxIntervalMs: 60_000,
        maxAccuracyM: 50,
        backgroundEnabled: false,
      },
    });

    expect(updated.locationStreaming).toEqual({
      streamEnabled: false,
      distanceFilterM: 250,
      maxIntervalMs: 60_000,
      maxAccuracyM: 50,
      backgroundEnabled: false,
    });
    expect(JSON.parse(preferenceState.get("mobile.config") ?? "{}")).toMatchObject({
      locationStreaming: updated.locationStreaming,
    });
  });
});
