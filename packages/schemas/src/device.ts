import { z } from "zod";

export const DeviceId = z
  .string()
  .trim()
  .min(1)
  .regex(/^dev-[a-z2-7]+$/, "device id must match dev-<base32>");
export type DeviceId = z.infer<typeof DeviceId>;

/** Ed25519 public key encoded as a string (recommended: base64url). */
export const DevicePubkey = z.string().trim().min(1);
export type DevicePubkey = z.infer<typeof DevicePubkey>;

export const DeviceDescriptor = z
  .object({
    device_id: DeviceId,
    pubkey: DevicePubkey,
    label: z.string().trim().min(1).optional(),
    platform: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeviceDescriptor = z.infer<typeof DeviceDescriptor>;

