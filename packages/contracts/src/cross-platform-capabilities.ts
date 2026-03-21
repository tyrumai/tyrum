import { z } from "zod";

// ---------------------------------------------------------------------------
// Cross-platform capabilities — platform-agnostic input/output schemas
// ---------------------------------------------------------------------------
// These schemas define the canonical shapes for location, camera, video, and
// audio capabilities shared across mobile and browser platforms.  They do NOT
// include the `op` field — that is part of the transport/dispatch layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export const LocationGetArgs = z
  .object({
    enable_high_accuracy: z.boolean().default(false),
    timeout_ms: z.number().int().min(0).max(600_000).default(30_000),
    maximum_age_ms: z.number().int().min(0).max(600_000).default(0),
  })
  .strict();
export type LocationGetArgs = z.infer<typeof LocationGetArgs>;

export const LocationGetCoords = z
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
export type LocationGetCoords = z.infer<typeof LocationGetCoords>;

export const LocationGetResult = z
  .object({
    coords: LocationGetCoords,
    timestamp: z.string().datetime(),
  })
  .strict();
export type LocationGetResult = z.infer<typeof LocationGetResult>;

// ---------------------------------------------------------------------------
// Camera — capture photo
// ---------------------------------------------------------------------------

export const CameraCapturePhotoArgs = z
  .object({
    facing_mode: z.enum(["user", "environment"]).optional(),
    format: z.enum(["jpeg", "png"]).default("jpeg"),
    quality: z.number().min(0).max(1).default(0.92),
  })
  .strict();
export type CameraCapturePhotoArgs = z.infer<typeof CameraCapturePhotoArgs>;

export const CameraCapturePhotoResult = z
  .object({
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type CameraCapturePhotoResult = z.infer<typeof CameraCapturePhotoResult>;

// ---------------------------------------------------------------------------
// Camera — capture video
// ---------------------------------------------------------------------------

export const CameraCaptureVideoArgs = z
  .object({
    duration_ms: z.number().int().min(250).max(300_000).default(5_000),
    camera: z.enum(["front", "rear"]).optional(),
    facing_mode: z.enum(["user", "environment"]).optional(),
    device_id: z.string().trim().min(1).optional(),
    format: z.string().trim().min(1).optional(),
  })
  .strict();
export type CameraCaptureVideoArgs = z.infer<typeof CameraCaptureVideoArgs>;

export const CameraCaptureVideoResult = z
  .object({
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    duration_ms: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type CameraCaptureVideoResult = z.infer<typeof CameraCaptureVideoResult>;

// ---------------------------------------------------------------------------
// Audio — record
// ---------------------------------------------------------------------------

export const AudioRecordArgs = z
  .object({
    duration_ms: z.number().int().min(250).max(300_000).default(5_000),
    mime: z.string().trim().min(1).optional(),
  })
  .strict();
export type AudioRecordArgs = z.infer<typeof AudioRecordArgs>;

export const AudioRecordResult = z
  .object({
    bytesBase64: z.string().min(1),
    mime: z.string().trim().min(1),
    duration_ms: z.number().int().nonnegative(),
    timestamp: z.string().datetime(),
  })
  .strict();
export type AudioRecordResult = z.infer<typeof AudioRecordResult>;
