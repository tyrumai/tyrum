// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  installCreateElementStub,
  makeTracks,
} from "./browser-capability-provider.test-support.js";

describe("createBrowserCapabilityProvider", () => {
  it("surfaces geolocation failures when the browser API is unavailable or rejects", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.stubGlobal("navigator", {});
    const unavailableProvider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    await expect(
      unavailableProvider.execute({
        type: "Browser",
        args: { op: "get", enable_high_accuracy: false, timeout_ms: 25, maximum_age_ms: 0 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Geolocation API unavailable (requires a secure context)",
    });

    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _onSuccess: (position: GeolocationPosition) => void,
          onError: (error: unknown) => void,
        ) => {
          onError("permission denied");
        },
      },
    });
    const rejectingProvider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    await expect(
      rejectingProvider.execute({
        type: "Browser",
        args: { op: "get", enable_high_accuracy: false, timeout_ms: 25, maximum_age_ms: 0 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "permission denied",
    });
  });

  it("captures a photo with modern browser APIs and preserves constraints", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const { drawImage, play } = installCreateElementStub({});

    class FileReaderWithEvents {
      error: Error | null = null;
      result: string | null = null;
      readonly #listeners = new Map<string, Set<() => void>>();

      addEventListener(eventName: string, listener: () => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<() => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      readAsDataURL(blob: Blob): void {
        void (async () => {
          const bytes = Buffer.from(await blob.arrayBuffer());
          this.result = `data:${blob.type};base64,${bytes.toString("base64")}`;
          for (const listener of this.#listeners.get("load") ?? []) {
            listener();
          }
        })();
      }
    }

    const tracks = makeTracks(2);
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      expect(constraints).toEqual({
        video: {
          deviceId: { exact: "camera-1" },
          facingMode: "environment",
        },
      });
      return {
        getTracks: () => tracks,
      };
    });

    vi.stubGlobal("FileReader", FileReaderWithEvents);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    const result = await provider.execute(
      {
        type: "Browser",
        args: {
          op: "capture_photo",
          format: "jpeg",
          quality: 0.92,
          facing_mode: "environment",
          device_id: "camera-1",
        },
      },
      {
        attemptId: "attempt-1",
        requestId: "request-1",
        runId: "run-1",
        stepId: "step-1",
      },
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "capture_photo",
      mime: "image/jpeg",
      width: 320,
      height: 240,
      bytesBase64: Buffer.from("photo", "utf8").toString("base64"),
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(tracks[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it("returns descriptive capture errors when the canvas cannot produce an image", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({
      getContext: () => null,
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => makeTracks(1),
        }),
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    await expect(
      provider.execute({
        type: "Browser",
        args: { op: "capture_photo", format: "png" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Canvas 2D context unavailable",
    });

    installCreateElementStub({
      canvasToBlob: (callback) => {
        callback(null);
      },
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => makeTracks(1),
        }),
      },
    });

    await expect(
      provider.execute({
        type: "Browser",
        args: { op: "capture_photo", format: "jpeg", quality: 0.6 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Failed to capture photo",
    });
  });

  it("rejects denied camera and microphone consent requests", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const deniedProvider = createBrowserCapabilityProvider({
      requestConsent: async (request) => request.scope !== "camera",
    });

    await expect(
      deniedProvider.execute({
        type: "Browser",
        args: { op: "capture_photo", format: "png" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "camera access denied",
    });

    const deniedMicrophoneProvider = createBrowserCapabilityProvider({
      requestConsent: async () => false,
    });
    await expect(
      deniedMicrophoneProvider.execute({
        type: "Browser",
        args: { op: "record", duration_ms: 25, mime: "audio/webm" },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "microphone access denied",
    });
  });

  it("returns recording errors when media APIs are missing or recorder events fail", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.stubGlobal("navigator", {});
    const noMediaProvider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    await expect(
      noMediaProvider.execute({
        type: "Browser",
        args: { op: "record", duration_ms: 10 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Microphone API unavailable (requires a secure context)",
    });

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => makeTracks(1),
        }),
      },
    });
    vi.stubGlobal("MediaRecorder", undefined);
    const noRecorderProvider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    await expect(
      noRecorderProvider.execute({
        type: "Browser",
        args: { op: "record", duration_ms: 10 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "MediaRecorder API unavailable",
    });

    vi.useFakeTimers();

    class EventedMediaRecorder {
      static isTypeSupported(mime: string): boolean {
        return mime === "audio/webm";
      }

      mimeType: string;
      readonly #listeners = new Map<string, Set<(event?: unknown) => void>>();

      constructor(_stream: unknown, options: MediaRecorderOptions) {
        this.mimeType = options.mimeType ?? "";
      }

      addEventListener(eventName: string, listener: (event?: unknown) => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<(event?: unknown) => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      start(): void {}

      stop(): void {
        for (const listener of this.#listeners.get("error") ?? []) {
          listener({ error: new Error("recorder failed") });
        }
      }
    }

    const tracks = makeTracks(1);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          expect(constraints).toEqual({
            audio: {
              deviceId: { exact: "microphone-1" },
            },
          });
          return {
            getTracks: () => tracks,
          };
        },
      },
    });
    vi.stubGlobal("MediaRecorder", EventedMediaRecorder);

    const failingProvider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const execution = failingProvider.execute({
      type: "Browser",
      args: {
        op: "record",
        duration_ms: 25,
        mime: "audio/webm",
        device_id: "microphone-1",
      },
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(execution).resolves.toMatchObject({
      success: false,
      error: "recorder failed",
    });
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });
});
