import type { CapabilityProvider, TaskExecuteContext, TaskResult } from "@tyrum/client";
import { BrowserActionArgs, type ActionPrimitive } from "@tyrum/schemas";

export type BrowserConsentScope = "geolocation" | "camera" | "microphone";

export interface BrowserConsentRequest {
  scope: BrowserConsentScope;
  title: string;
  description: string;
  context?: TaskExecuteContext;
}

export type RequestBrowserConsent = (request: BrowserConsentRequest) => Promise<boolean>;

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function assignLegacyEventHandler<T extends object>(
  target: T,
  eventProperty: string,
  handler: ((event?: unknown) => void) | null,
): void {
  Reflect.set(target, eventProperty, handler);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const onError = () => {
      reject(reader.error ?? new Error("Failed to read blob"));
    };
    const onLoad = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Expected a data URL string"));
        return;
      }
      const index = reader.result.indexOf(",");
      if (index === -1) {
        reject(new Error("Invalid data URL"));
        return;
      }
      resolve(reader.result.slice(index + 1));
    };
    if (typeof reader.addEventListener === "function") {
      reader.addEventListener("error", onError);
      reader.addEventListener("load", onLoad);
    } else {
      assignLegacyEventHandler(reader, "onerror", onError);
      assignLegacyEventHandler(reader, "onload", onLoad);
    }
    reader.readAsDataURL(blob);
  });
}

function getCurrentPosition(
  args: BrowserActionArgs & { op: "geolocation.get" },
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    const api = globalThis.navigator?.geolocation;
    if (!api) {
      reject(new Error("Geolocation API unavailable (requires a secure context)"));
      return;
    }

    api.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: args.enable_high_accuracy,
      timeout: args.timeout_ms,
      maximumAge: args.maximum_age_ms,
    });
  });
}

async function capturePhoto(args: BrowserActionArgs & { op: "camera.capture_photo" }): Promise<{
  bytesBase64: string;
  mime: string;
  width: number;
  height: number;
}> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Camera API unavailable (requires a secure context)");
  }

  const constraints: MediaStreamConstraints = {
    video: {
      ...(args.facing_mode ? { facingMode: args.facing_mode } : {}),
      ...(args.device_id ? { deviceId: { exact: args.device_id } } : {}),
    },
  };

  const stream = await mediaDevices.getUserMedia(constraints);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise<void>((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });

    try {
      await video.play();
    } catch {
      // Autoplay restrictions vary; drawing the current frame may still succeed.
    }

    const width = Math.max(1, video.videoWidth || 640);
    const height = Math.max(1, video.videoHeight || 480);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    ctx.drawImage(video, 0, 0, width, height);

    const mime = args.format === "png" ? "image/png" : "image/jpeg";
    const quality = args.format === "jpeg" ? args.quality : undefined;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => {
          if (!value) {
            reject(new Error("Failed to capture photo"));
            return;
          }
          resolve(value);
        },
        mime,
        quality,
      );
    });

    const bytesBase64 = await blobToBase64(blob);
    return { bytesBase64, mime: blob.type || mime, width, height };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

async function recordAudio(args: BrowserActionArgs & { op: "microphone.record" }): Promise<{
  bytesBase64: string;
  mime: string;
  duration_ms: number;
}> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("Microphone API unavailable (requires a secure context)");
  }
  if (typeof globalThis.MediaRecorder !== "function") {
    throw new Error("MediaRecorder API unavailable");
  }

  const audioConstraints: MediaTrackConstraints = {};
  if (args.device_id) {
    audioConstraints.deviceId = { exact: args.device_id };
  }

  const constraints: MediaStreamConstraints = {
    audio: audioConstraints,
  };

  const stream = await mediaDevices.getUserMedia(constraints);
  try {
    const options: MediaRecorderOptions = {};
    if (args.mime && MediaRecorder.isTypeSupported(args.mime)) {
      options.mimeType = args.mime;
    }

    const recorder = new MediaRecorder(stream, options);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (evt) => {
      if (evt.data && evt.data.size > 0) {
        chunks.push(evt.data);
      }
    };

    const startedAt = Date.now();
    const stopped = new Promise<void>((resolve, reject) => {
      const onStop = () => resolve();
      const onError = (evt: unknown) => {
        const errorValue =
          evt && typeof evt === "object" && "error" in evt
            ? (evt as { error?: unknown }).error
            : evt;
        reject(errorValue ?? new Error("Recording failed"));
      };
      if (typeof recorder.addEventListener === "function") {
        recorder.addEventListener("stop", onStop, { once: true });
        recorder.addEventListener("error", onError);
      } else {
        assignLegacyEventHandler(recorder, "onstop", onStop);
        assignLegacyEventHandler(recorder, "onerror", onError);
      }
    });

    recorder.start();
    const timer = setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }, args.duration_ms);

    try {
      await stopped;
    } finally {
      clearTimeout(timer);
    }

    const blob = new Blob(chunks, { type: recorder.mimeType || options.mimeType || "" });
    const bytesBase64 = await blobToBase64(blob);
    return {
      bytesBase64,
      mime: blob.type || "application/octet-stream",
      duration_ms: Math.max(0, Date.now() - startedAt),
    };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

export function createBrowserCapabilityProvider(options: {
  requestConsent: RequestBrowserConsent;
}): CapabilityProvider {
  return {
    capability: "browser",
    async execute(action: ActionPrimitive, ctx?: TaskExecuteContext): Promise<TaskResult> {
      if (action.type !== "Browser") {
        return {
          success: false,
          error: `unsupported action type: ${action.type}`,
        };
      }

      const parsedArgs = BrowserActionArgs.safeParse(action.args);
      if (!parsedArgs.success) {
        return {
          success: false,
          error: `invalid browser args: ${parsedArgs.error.message}`,
        };
      }

      const args = parsedArgs.data;
      const timestamp = new Date().toISOString();

      try {
        if (args.op === "geolocation.get") {
          const allowed = await options.requestConsent({
            scope: "geolocation",
            title: "Share location?",
            description: "A workflow is requesting your location via the browser geolocation API.",
            context: ctx,
          });
          if (!allowed) return { success: false, error: "location access denied" };

          const position = await getCurrentPosition(args);
          const coords = position.coords;

          return {
            success: true,
            evidence: {
              op: "geolocation.get",
              coords: {
                latitude: coords.latitude,
                longitude: coords.longitude,
                accuracy_m: coords.accuracy,
                altitude_m: coords.altitude,
                altitude_accuracy_m: coords.altitudeAccuracy,
                heading_deg: coords.heading,
                speed_mps: coords.speed,
              },
              timestamp,
            },
          };
        }

        if (args.op === "camera.capture_photo") {
          const allowed = await options.requestConsent({
            scope: "camera",
            title: "Allow camera capture?",
            description: "A workflow is requesting a photo from your camera.",
            context: ctx,
          });
          if (!allowed) return { success: false, error: "camera access denied" };

          const captured = await capturePhoto(args);

          return {
            success: true,
            evidence: {
              op: "camera.capture_photo",
              ...captured,
              timestamp,
            },
          };
        }

        const allowed = await options.requestConsent({
          scope: "microphone",
          title: "Allow microphone recording?",
          description: "A workflow is requesting a microphone recording.",
          context: ctx,
        });
        if (!allowed) return { success: false, error: "microphone access denied" };

        const recorded = await recordAudio(args);
        return {
          success: true,
          evidence: {
            op: "microphone.record",
            ...recorded,
            timestamp,
          },
        };
      } catch (error) {
        return { success: false, error: formatUnknownError(error) };
      }
    },
  };
}
