import { z } from "zod";

export const MobileLocationGetCurrentArgs = z
  .object({
    op: z.literal("location.get_current"),
    enable_high_accuracy: z.boolean().default(false),
    timeout_ms: z.number().int().min(0).max(600_000).default(30_000),
    maximum_age_ms: z.number().int().min(0).max(600_000).default(0),
  })
  .strict();
export type MobileLocationGetCurrentArgs = z.infer<typeof MobileLocationGetCurrentArgs>;

export const MobileCameraTarget = z.enum(["front", "rear"]);
export type MobileCameraTarget = z.infer<typeof MobileCameraTarget>;

export const MobileCameraCapturePhotoFormat = z.enum(["jpeg", "png"]);
export type MobileCameraCapturePhotoFormat = z.infer<typeof MobileCameraCapturePhotoFormat>;

export const MobileCameraCapturePhotoArgs = z
  .object({
    op: z.literal("camera.capture_photo"),
    camera: MobileCameraTarget.optional(),
    format: MobileCameraCapturePhotoFormat.default("jpeg"),
    quality: z.number().min(0).max(1).default(0.92),
  })
  .strict();
export type MobileCameraCapturePhotoArgs = z.infer<typeof MobileCameraCapturePhotoArgs>;

export const MobileAudioRecordClipArgs = z
  .object({
    op: z.literal("audio.record_clip"),
    duration_ms: z.number().int().min(250).max(300_000).default(5_000),
    mime: z.string().trim().min(1).optional(),
  })
  .strict();
export type MobileAudioRecordClipArgs = z.infer<typeof MobileAudioRecordClipArgs>;

export const MobileLocationCoords = z
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
export type MobileLocationCoords = z.infer<typeof MobileLocationCoords>;

export const MobileLocationGetCurrentResult = z
  .object({
    op: z.literal("location.get_current"),
    coords: MobileLocationCoords,
    timestamp: z.string().datetime(),
  })
  .strict();
export type MobileLocationGetCurrentResult = z.infer<typeof MobileLocationGetCurrentResult>;

export const MobileCameraCapturePhotoResult = z
  .object({
    op: z.literal("camera.capture_photo"),
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type MobileCameraCapturePhotoResult = z.infer<typeof MobileCameraCapturePhotoResult>;

export const MobileAudioRecordClipResult = z
  .object({
    op: z.literal("audio.record_clip"),
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    duration_ms: z.number().int().nonnegative(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type MobileAudioRecordClipResult = z.infer<typeof MobileAudioRecordClipResult>;

export const MobileActionArgs = z.discriminatedUnion("op", [
  MobileLocationGetCurrentArgs,
  MobileCameraCapturePhotoArgs,
  MobileAudioRecordClipArgs,
]);
export type MobileActionArgs = z.infer<typeof MobileActionArgs>;

export const MobileActionResult = z.discriminatedUnion("op", [
  MobileLocationGetCurrentResult,
  MobileCameraCapturePhotoResult,
  MobileAudioRecordClipResult,
]);
export type MobileActionResult = z.infer<typeof MobileActionResult>;
