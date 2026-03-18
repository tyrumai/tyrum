// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCapabilityProvider } from "../../src/browser-node/browser-capability-provider.js";

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createBrowserCapabilityProvider", () => {
  it("rejects unsupported action types", async () => {
    stubLocalStorage();
    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    const result = await provider.execute({ type: "Desktop", args: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported action type: Desktop");
  });

  it("returns geolocation coords when allowed", async () => {
    stubLocalStorage();
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          onSuccess: (pos: GeolocationPosition) => void,
          _onError: (err: unknown) => void,
        ) => {
          onSuccess({
            coords: {
              latitude: 10,
              longitude: 20,
              accuracy: 5,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
          } as unknown as GeolocationPosition);
        },
      },
    });

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    const result = await provider.execute({
      type: "Browser",
      args: { op: "get" },
    });

    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence["op"]).toBe("get");
    expect(evidence["coords"]).toMatchObject({
      latitude: 10,
      longitude: 20,
      accuracy_m: 5,
    });
  });

  it("returns a descriptive error when camera APIs are unavailable", async () => {
    stubLocalStorage();
    vi.stubGlobal("navigator", {});

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    const result = await provider.execute({
      type: "Browser",
      args: { op: "capture_photo", format: "jpeg", quality: 0.92 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Camera API unavailable");
  });

  it("records audio and returns base64 evidence", async () => {
    stubLocalStorage();
    vi.useFakeTimers();

    class FakeFileReader {
      result: string | null = null;
      error: Error | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;

      readAsDataURL(blob: Blob): void {
        void (async () => {
          try {
            const bytes = Buffer.from(await blob.arrayBuffer());
            this.result = `data:${blob.type || "application/octet-stream"};base64,${bytes.toString(
              "base64",
            )}`;
            this.onload?.();
          } catch (err) {
            this.error = err instanceof Error ? err : new Error(String(err));
            this.onerror?.();
          }
        })();
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported(mime: string): boolean {
        return mime === "audio/webm";
      }

      mimeType: string;
      ondataavailable: ((evt: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((evt: unknown) => void) | null = null;

      #stopped = false;

      constructor(_stream: unknown, options: MediaRecorderOptions) {
        this.mimeType = options.mimeType ?? "";
      }

      start(): void {}

      stop(): void {
        if (this.#stopped) return;
        this.#stopped = true;
        try {
          const blob = new Blob(["hello"], { type: this.mimeType });
          this.ondataavailable?.({ data: blob });
          this.onstop?.();
        } catch (err) {
          this.onerror?.(err);
        }
      }
    }

    const stopTrack = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: stopTrack }],
    };

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => fakeStream,
      },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("FileReader", FakeFileReader);

    const provider = createBrowserCapabilityProvider({
      requestConsent: async () => true,
    });

    const promise = provider.execute({
      type: "Browser",
      args: { op: "record", duration_ms: 250, mime: "audio/webm" },
    });

    await vi.advanceTimersByTimeAsync(250);
    const result = await promise;

    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence["op"]).toBe("record");
    expect(evidence["mime"]).toBe("audio/webm");
    expect(evidence["bytesBase64"]).toBe(Buffer.from("hello", "utf8").toString("base64"));
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
