// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  installCreateElementStub,
  makeTracks,
} from "./browser-capability-provider.test-support.js";

describe("createBrowserCapabilityProvider capture flows", () => {
  it("returns an error for unsupported action types", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    await expect(provider.execute({ type: "Unknown", args: {} })).resolves.toMatchObject({
      success: false,
      error: "unsupported action type: Unknown",
    });
  });

  it("returns an error for invalid browser args", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    await expect(
      provider.execute({ type: "Browser", args: { op: "invalid_op" } }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("invalid browser args"),
    });
  });

  it("returns denied when geolocation consent is refused", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => false,
    });

    await expect(
      provider.execute({
        type: "Browser",
        args: { op: "get", enable_high_accuracy: false, timeout_ms: 25, maximum_age_ms: 0 },
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "location access denied",
    });
  });

  it("captures a PNG photo and falls back to video dimension defaults when zero", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");
    const { drawImage } = installCreateElementStub({
      videoWidth: 0,
      videoHeight: 0,
    });

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

    const tracks = makeTracks(1);
    vi.stubGlobal("FileReader", FileReaderWithEvents);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => tracks }),
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const result = await provider.execute({
      type: "Browser",
      args: { op: "capture_photo", format: "png" },
    });

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "capture_photo",
      mime: "image/png",
      width: 640,
      height: 480,
    });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 480);
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to the format mime type when blob.type is empty for photo capture", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({
      canvasToBlob: (callback: BlobCallback) => {
        callback(new Blob(["photo"], { type: "" }));
      },
    });

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
          this.result = `data:image/jpeg;base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
          for (const listener of this.#listeners.get("load") ?? []) {
            listener();
          }
        })();
      }
    }

    vi.stubGlobal("FileReader", FileReaderWithEvents);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const result = await provider.execute({
      type: "Browser",
      args: { op: "capture_photo", format: "jpeg", quality: 0.9 },
    });

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "capture_photo",
      mime: "image/jpeg",
    });
  });

  it("rejects via blobToBase64 when FileReader.result is not a string", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({});

    class FileReaderNonStringResult {
      error: Error | null = null;
      result: ArrayBuffer | null = null;
      readonly #listeners = new Map<string, Set<() => void>>();

      addEventListener(eventName: string, listener: () => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<() => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      readAsDataURL(_blob: Blob): void {
        this.result = new ArrayBuffer(8);
        for (const listener of this.#listeners.get("load") ?? []) {
          listener();
        }
      }
    }

    vi.stubGlobal("FileReader", FileReaderNonStringResult);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
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
      error: "Expected a data URL string",
    });
  });

  it("rejects via blobToBase64 when the data URL has no comma", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({});

    class FileReaderNoComma {
      error: Error | null = null;
      result: string | null = null;
      readonly #listeners = new Map<string, Set<() => void>>();

      addEventListener(eventName: string, listener: () => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<() => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      readAsDataURL(_blob: Blob): void {
        this.result = "data:image/png;base64-without-comma";
        for (const listener of this.#listeners.get("load") ?? []) {
          listener();
        }
      }
    }

    vi.stubGlobal("FileReader", FileReaderNoComma);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
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
      error: "Invalid data URL",
    });
  });

  it("rejects via blobToBase64 error path using reader.error when available", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({});

    class FileReaderWithError {
      error: Error | null = new Error("read failed");
      result: string | null = null;
      readonly #listeners = new Map<string, Set<() => void>>();

      addEventListener(eventName: string, listener: () => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<() => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      readAsDataURL(_blob: Blob): void {
        for (const listener of this.#listeners.get("error") ?? []) {
          listener();
        }
      }
    }

    vi.stubGlobal("FileReader", FileReaderWithError);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
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
      error: "read failed",
    });
  });

  it("rejects via blobToBase64 error path with fallback when reader.error is null", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({});

    class FileReaderWithNullError {
      error: Error | null = null;
      result: string | null = null;
      readonly #listeners = new Map<string, Set<() => void>>();

      addEventListener(eventName: string, listener: () => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<() => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      readAsDataURL(_blob: Blob): void {
        for (const listener of this.#listeners.get("error") ?? []) {
          listener();
        }
      }
    }

    vi.stubGlobal("FileReader", FileReaderWithNullError);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
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
      error: "Failed to read blob",
    });
  });

  it("uses legacy event handlers when addEventListener is unavailable on FileReader", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    installCreateElementStub({});

    class FileReaderLegacy {
      error: Error | null = null;
      result: string | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      readAsDataURL(blob: Blob): void {
        void (async () => {
          const bytes = Buffer.from(await blob.arrayBuffer());
          this.result = `data:${blob.type};base64,${bytes.toString("base64")}`;
          this.onload?.();
        })();
      }
    }

    vi.stubGlobal("FileReader", FileReaderLegacy);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => makeTracks(1) }),
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const result = await provider.execute({
      type: "Browser",
      args: { op: "capture_photo", format: "jpeg", quality: 0.8 },
    });

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "capture_photo",
      mime: "image/jpeg",
    });
  });

  it("handles camera API unavailable scenario", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.stubGlobal("navigator", {});

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
      error: "Camera API unavailable (requires a secure context)",
    });
  });
});
