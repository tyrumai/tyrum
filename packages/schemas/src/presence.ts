import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const PresenceRole = z.enum(["gateway", "client", "node"]);
export type PresenceRole = z.infer<typeof PresenceRole>;

export const PresenceMode = z.enum([
  "ui",
  "web",
  "cli",
  "node",
  "backend",
  "probe",
  "test",
]);
export type PresenceMode = z.infer<typeof PresenceMode>;

export const PresenceReason = z.enum(["self", "connect", "periodic", "node-connected"]);
export type PresenceReason = z.infer<typeof PresenceReason>;

export const PresenceEntry = z
  .object({
    instance_id: z.string().trim().min(1),
    role: PresenceRole,
    host: z.string().trim().min(1).optional(),
    ip: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    mode: PresenceMode,
    last_seen_at: DateTimeSchema,
    last_input_seconds: z.number().int().nonnegative().optional(),
    reason: PresenceReason,
  })
  .strict();
export type PresenceEntry = z.infer<typeof PresenceEntry>;

export const PresenceBeaconPayload = z
  .object({
    host: z.string().trim().min(1).optional(),
    ip: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    mode: PresenceMode.optional(),
    last_input_seconds: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PresenceBeaconPayload = z.infer<typeof PresenceBeaconPayload>;

