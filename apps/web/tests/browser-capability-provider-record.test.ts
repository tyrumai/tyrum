// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { makeTracks } from "./browser-capability-provider.test-support.js";

describe("createBrowserCapabilityProvider recording flows", () => {
  it("successfully records audio with a proper stop event and data chunks", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.useFakeTimers();

    class SuccessfulMediaRecorder {
      static isTypeSupported(mime: string): boolean {
        return mime === "audio/webm";
      }

      mimeType: string;
      ondataavailable: ((evt: { data: Blob }) => void) | null = null;
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
        this.ondataavailable?.({ data: new Blob(["audio-data"], { type: this.mimeType }) });
        for (const listener of this.#listeners.get("stop") ?? []) {
          listener();
        }
      }
    }

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
          this.result = `data:audio/webm;base64,${bytes.toString("base64")}`;
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
    vi.stubGlobal("MediaRecorder", SuccessfulMediaRecorder);

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const execution = provider.execute({
      type: "Browser",
      args: {
        op: "record",
        duration_ms: 50,
        mime: "audio/webm",
      },
    });

    await vi.advanceTimersByTimeAsync(50);
    const result = await execution;

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "record",
      mime: "audio/webm",
    });
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("records audio without a device_id and with an unsupported mime type", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.useFakeTimers();

    class MinimalMediaRecorder {
      static isTypeSupported(_mime: string): boolean {
        return false;
      }

      mimeType = "";
      ondataavailable: ((evt: { data: Blob }) => void) | null = null;
      readonly #listeners = new Map<string, Set<(event?: unknown) => void>>();

      addEventListener(eventName: string, listener: (event?: unknown) => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<(event?: unknown) => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      start(): void {}

      stop(): void {
        for (const listener of this.#listeners.get("stop") ?? []) {
          listener();
        }
      }
    }

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
          this.result = `data:application/octet-stream;base64,${bytes.toString("base64")}`;
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
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          expect(constraints).toEqual({ audio: {} });
          return { getTracks: () => tracks };
        },
      },
    });
    vi.stubGlobal("MediaRecorder", MinimalMediaRecorder);

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const execution = provider.execute({
      type: "Browser",
      args: {
        op: "record",
        duration_ms: 10,
        mime: "audio/unsupported",
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await execution;

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      op: "record",
      mime: "application/octet-stream",
    });
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("uses legacy event handlers on MediaRecorder and handles error events with fallback", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.useFakeTimers();

    class LegacyMediaRecorder {
      static isTypeSupported(): boolean {
        return false;
      }

      mimeType = "";
      ondataavailable: ((evt: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((evt?: unknown) => void) | null = null;

      start(): void {}

      stop(): void {
        this.onerror?.({ error: null });
      }
    }

    const tracks = makeTracks(1);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => tracks }),
      },
    });
    vi.stubGlobal("MediaRecorder", LegacyMediaRecorder);

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const execution = provider.execute({
      type: "Browser",
      args: {
        op: "record",
        duration_ms: 10,
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Recording failed");
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("handles recorder error events where evt is the error value itself", async () => {
    const { createBrowserCapabilityProvider } =
      await import("../src/browser-node/browser-capability-provider.js");

    vi.useFakeTimers();

    class RecorderWithPlainError {
      static isTypeSupported(): boolean {
        return false;
      }

      mimeType = "";
      ondataavailable: ((evt: { data: Blob }) => void) | null = null;
      readonly #listeners = new Map<string, Set<(event?: unknown) => void>>();

      addEventListener(eventName: string, listener: (event?: unknown) => void): void {
        const listeners = this.#listeners.get(eventName) ?? new Set<(event?: unknown) => void>();
        listeners.add(listener);
        this.#listeners.set(eventName, listeners);
      }

      start(): void {}

      stop(): void {
        for (const listener of this.#listeners.get("error") ?? []) {
          listener("some error string");
        }
      }
    }

    const tracks = makeTracks(1);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => tracks }),
      },
    });
    vi.stubGlobal("MediaRecorder", RecorderWithPlainError);

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });
    const execution = provider.execute({
      type: "Browser",
      args: {
        op: "record",
        duration_ms: 10,
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.error).toBe("some error string");
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
  });
});
