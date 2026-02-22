import { z } from "zod";

/** Client capability kinds. */
export const ClientCapability = z.enum(["playwright", "android", "desktop", "cli", "http"]);
export type ClientCapability = z.infer<typeof ClientCapability>;

/**
 * Capability descriptor used in the vNext handshake.
 *
 * Today this is intentionally minimal and uses the existing capability enum.
 * The target architecture allows richer, namespaced capabilities over time.
 */
export const CapabilityDescriptor = z
  .object({
    id: ClientCapability,
    version: z.string().trim().min(1).optional(),
  })
  .strict();
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptor>;

