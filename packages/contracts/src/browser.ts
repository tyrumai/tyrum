import { z } from "zod";

// ---------------------------------------------------------------------------
// Browser actions — arguments
// ---------------------------------------------------------------------------

export const BrowserGeolocationGetArgs = z
  .object({
    op: z.literal("get"),
    enable_high_accuracy: z.boolean().default(false),
    timeout_ms: z.number().int().min(0).max(600_000).default(30_000),
    maximum_age_ms: z.number().int().min(0).max(600_000).default(0),
  })
  .strict();
export type BrowserGeolocationGetArgs = z.infer<typeof BrowserGeolocationGetArgs>;

export const BrowserCameraFacingMode = z.enum(["user", "environment"]);
export type BrowserCameraFacingMode = z.infer<typeof BrowserCameraFacingMode>;

export const BrowserCameraCapturePhotoFormat = z.enum(["jpeg", "png"]);
export type BrowserCameraCapturePhotoFormat = z.infer<typeof BrowserCameraCapturePhotoFormat>;

export const BrowserCameraCapturePhotoArgs = z
  .object({
    op: z.literal("capture_photo"),
    facing_mode: BrowserCameraFacingMode.optional(),
    device_id: z.string().trim().min(1).optional(),
    format: BrowserCameraCapturePhotoFormat.default("jpeg"),
    quality: z.number().min(0).max(1).default(0.92),
  })
  .strict();
export type BrowserCameraCapturePhotoArgs = z.infer<typeof BrowserCameraCapturePhotoArgs>;

export const BrowserMicrophoneRecordArgs = z
  .object({
    op: z.literal("record"),
    duration_ms: z.number().int().min(250).max(300_000).default(5_000),
    mime: z.string().trim().min(1).optional(),
    device_id: z.string().trim().min(1).optional(),
  })
  .strict();
export type BrowserMicrophoneRecordArgs = z.infer<typeof BrowserMicrophoneRecordArgs>;

/** Discriminated union of all browser action argument types. */
export const BrowserActionArgs = z.discriminatedUnion("op", [
  BrowserGeolocationGetArgs,
  BrowserCameraCapturePhotoArgs,
  BrowserMicrophoneRecordArgs,
]);
export type BrowserActionArgs = z.infer<typeof BrowserActionArgs>;

// ---------------------------------------------------------------------------
// Browser action results / evidence (bounded)
// ---------------------------------------------------------------------------

export const BrowserGeolocationCoords = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy_m: z.number().nonnegative(),
    altitude_m: z.number().nullable().optional(),
    altitude_accuracy_m: z.number().nonnegative().nullable().optional(),
    heading_deg: z.number().nullable().optional(),
    speed_mps: z.number().nullable().optional(),
  })
  .strict();
export type BrowserGeolocationCoords = z.infer<typeof BrowserGeolocationCoords>;

export const BrowserGeolocationGetResult = z
  .object({
    op: z.literal("get"),
    coords: BrowserGeolocationCoords,
    timestamp: z.string().datetime(),
  })
  .strict();
export type BrowserGeolocationGetResult = z.infer<typeof BrowserGeolocationGetResult>;

export const BrowserCameraCapturePhotoResult = z
  .object({
    op: z.literal("capture_photo"),
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type BrowserCameraCapturePhotoResult = z.infer<typeof BrowserCameraCapturePhotoResult>;

export const BrowserMicrophoneRecordResult = z
  .object({
    op: z.literal("record"),
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    duration_ms: z.number().int().nonnegative(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type BrowserMicrophoneRecordResult = z.infer<typeof BrowserMicrophoneRecordResult>;

export const BrowserActionResult = z.discriminatedUnion("op", [
  BrowserGeolocationGetResult,
  BrowserCameraCapturePhotoResult,
  BrowserMicrophoneRecordResult,
]);
export type BrowserActionResult = z.infer<typeof BrowserActionResult>;
