import { afterEach, vi } from "vitest";

vi.mock("../src/browser-node/browser-runtime.js", () => ({
  BrowserActionArgs: {
    safeParse(input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { success: false, error: { message: "invalid browser args" } };
      }
      const op = (input as { op?: unknown }).op;
      if (op !== "get" && op !== "capture_photo" && op !== "record") {
        return { success: false, error: { message: "invalid browser args" } };
      }
      return { success: true, data: input };
    },
  },
}));

type MockTrack = { stop: ReturnType<typeof vi.fn> };

export function makeTracks(count = 1): MockTrack[] {
  return Array.from({ length: count }, () => ({ stop: vi.fn() }));
}

export function installCreateElementStub(options: {
  canvasToBlob?: (callback: BlobCallback, type?: string, quality?: unknown) => void;
  getContext?: () => CanvasRenderingContext2D | null;
  videoHeight?: number;
  videoWidth?: number;
}): {
  drawImage: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
} {
  const drawImage = vi.fn();
  const play = vi.fn(async () => {
    throw new Error("autoplay blocked");
  });
  const originalCreateElement = document.createElement.bind(document);
  const getContext =
    options.getContext ??
    (() =>
      ({
        drawImage,
      }) as unknown as CanvasRenderingContext2D);
  const toBlob =
    options.canvasToBlob ??
    ((callback: BlobCallback, type?: string) => {
      callback(new Blob(["photo"], { type: type ?? "image/jpeg" }));
    });

  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName === "video") {
      return {
        addEventListener: (eventName: string, handler: () => void) => {
          if (eventName === "loadedmetadata") {
            queueMicrotask(handler);
          }
        },
        muted: false,
        play,
        playsInline: false,
        srcObject: null,
        videoHeight: options.videoHeight ?? 240,
        videoWidth: options.videoWidth ?? 320,
      } as unknown as ReturnType<typeof originalCreateElement>;
    }

    if (tagName === "canvas") {
      return {
        getContext,
        height: 0,
        toBlob,
        width: 0,
      } as unknown as ReturnType<typeof originalCreateElement>;
    }

    return originalCreateElement(tagName);
  }) as typeof document.createElement);

  return { drawImage, play };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});
