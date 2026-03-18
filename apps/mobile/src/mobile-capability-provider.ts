import type { CapabilityProvider, TaskExecuteContext, TaskResult } from "@tyrum/client";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { AndroidActionArgs, IosActionArgs, type ActionPrimitive } from "@tyrum/schemas";
import type { MobileHostPlatform } from "@tyrum/operator-ui";
import { formatUnknownError, mapLocationCoords } from "./mobile-location-utils.js";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Expected a data URL string."));
        return;
      }
      const commaIndex = reader.result.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("Invalid data URL."));
        return;
      }
      resolve(reader.result.slice(commaIndex + 1));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read blob."));
    });
    reader.readAsDataURL(blob);
  });
}

async function measureBase64Image(
  base64: string,
  mime: string,
): Promise<{ width?: number; height?: number }> {
  if (typeof globalThis.Image !== "function") {
    return {};
  }

  return await new Promise((resolve) => {
    const image = new Image();
    image.addEventListener(
      "load",
      () => {
        resolve({
          width: Math.max(1, image.naturalWidth || image.width || 1),
          height: Math.max(1, image.naturalHeight || image.height || 1),
        });
      },
      { once: true },
    );
    image.addEventListener("error", () => resolve({}), { once: true });
    image.src = `data:${mime};base64,${base64}`;
  });
}

async function getCurrentLocation(
  args: Extract<IosActionArgs | AndroidActionArgs, { op: "location.get_current" }>,
) {
  if (Capacitor.isNativePlatform()) {
    await Geolocation.requestPermissions();
  }
  const position = await Geolocation.getCurrentPosition({
    enableHighAccuracy: args.enable_high_accuracy,
    timeout: args.timeout_ms,
    maximumAge: args.maximum_age_ms,
  });

  return {
    coords: mapLocationCoords(position.coords),
    timestamp: new Date(position.timestamp).toISOString(),
  };
}

async function capturePhoto(
  args: Extract<IosActionArgs | AndroidActionArgs, { op: "camera.capture_photo" }>,
) {
  if (Capacitor.isNativePlatform()) {
    await Camera.requestPermissions({ permissions: ["camera"] });
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Base64,
    correctOrientation: true,
    quality: Math.round((args.quality ?? 0.92) * 100),
    direction: args.camera === "front" ? CameraDirection.Front : CameraDirection.Rear,
  });

  const bytesBase64 = photo.base64String;
  if (!bytesBase64) {
    throw new Error("Camera capture did not return base64 image data.");
  }
  const mime = photo.format ? `image/${photo.format}` : "image/jpeg";
  const dimensions = await measureBase64Image(bytesBase64, mime);

  return {
    bytesBase64,
    mime,
    ...(dimensions.width ? { width: dimensions.width } : {}),
    ...(dimensions.height ? { height: dimensions.height } : {}),
    timestamp: new Date().toISOString(),
  };
}

async function recordAudioClip(
  args: Extract<IosActionArgs | AndroidActionArgs, { op: "audio.record_clip" }>,
) {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) {
    throw new Error("mediaDevices.getUserMedia is unavailable.");
  }
  if (typeof globalThis.MediaRecorder !== "function") {
    throw new Error("MediaRecorder is unavailable.");
  }

  const stream = await mediaDevices.getUserMedia({ audio: true });
  try {
    const recorderOptions: MediaRecorderOptions = {};
    if (args.mime && MediaRecorder.isTypeSupported(args.mime)) {
      recorderOptions.mimeType = args.mime;
    }
    const recorder = new MediaRecorder(stream, recorderOptions);
    const chunks: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    const startedAt = Date.now();
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", (event) => {
        reject((event as Event & { error?: unknown }).error ?? new Error("Recording failed."));
      });
    });

    recorder.start();
    const durationMs = args.duration_ms ?? 5_000;
    const stopTimer = globalThis.setTimeout(() => {
      try {
        recorder.stop();
      } catch {
        // Ignore duplicate stop attempts.
      }
    }, durationMs);

    try {
      await stopped;
    } finally {
      globalThis.clearTimeout(stopTimer);
    }

    const blob = new Blob(chunks, {
      type: recorder.mimeType || recorderOptions.mimeType || "audio/webm",
    });
    return {
      bytesBase64: await blobToBase64(blob),
      mime: blob.type || "audio/webm",
      duration_ms: Math.max(0, Date.now() - startedAt),
      timestamp: new Date().toISOString(),
    };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

export function createMobileCapabilityProvider(platform: MobileHostPlatform): CapabilityProvider {
  return {
    capability: platform,
    capabilityIds: ["tyrum.location.get", "tyrum.camera.capture-photo", "tyrum.audio.record"],
    async execute(action: ActionPrimitive, _ctx?: TaskExecuteContext): Promise<TaskResult> {
      const argsResult =
        platform === "ios"
          ? IosActionArgs.safeParse(action.args)
          : AndroidActionArgs.safeParse(action.args);
      const expectedType = platform === "ios" ? "IOS" : "Android";
      if (action.type !== expectedType) {
        return { success: false, error: `unsupported action type: ${action.type}` };
      }
      if (!argsResult.success) {
        return { success: false, error: argsResult.error.message };
      }

      const args = argsResult.data;
      try {
        if (args.op === "location.get_current") {
          return { success: true, evidence: { op: args.op, ...(await getCurrentLocation(args)) } };
        }
        if (args.op === "camera.capture_photo") {
          return { success: true, evidence: { op: args.op, ...(await capturePhoto(args)) } };
        }
        if (args.op === "audio.record_clip") {
          return { success: true, evidence: { op: args.op, ...(await recordAudioClip(args)) } };
        }
        return { success: false, error: "unsupported mobile op" };
      } catch (error) {
        return { success: false, error: formatUnknownError(error) };
      }
    },
  };
}
