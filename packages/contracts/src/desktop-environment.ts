import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { NodeId } from "./keys.js";

export const DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF = "ghcr.io/tyrumai/tyrum-desktop-sandbox:main";

export const DesktopEnvironmentId = z.string().trim().min(1);
export const DesktopEnvironmentHostId = z.string().trim().min(1);
const DesktopEnvironmentLabel = z.string().trim().min(1);
const DesktopEnvironmentImageRef = z.string().trim().min(1);
const DesktopEnvironmentError = z.string().trim().min(1);
const DesktopEnvironmentLogLine = z.string();

export const DesktopEnvironmentStatus = z.enum([
  "pending",
  "starting",
  "running",
  "stopping",
  "stopped",
  "error",
]);
export type DesktopEnvironmentStatus = z.infer<typeof DesktopEnvironmentStatus>;

export const DesktopEnvironmentManagedKind = z.enum(["docker"]);
export type DesktopEnvironmentManagedKind = z.infer<typeof DesktopEnvironmentManagedKind>;

export const ManagedDesktopReference = z
  .object({
    environment_id: DesktopEnvironmentId,
  })
  .strict();
export type ManagedDesktopReference = z.infer<typeof ManagedDesktopReference>;

export const DesktopEnvironmentHost = z
  .object({
    host_id: DesktopEnvironmentHostId,
    label: DesktopEnvironmentLabel,
    version: z.string().trim().min(1).nullable(),
    docker_available: z.boolean(),
    healthy: z.boolean(),
    last_seen_at: DateTimeSchema.nullable(),
    last_error: DesktopEnvironmentError.nullable(),
  })
  .strict();
export type DesktopEnvironmentHost = z.infer<typeof DesktopEnvironmentHost>;

export function isDesktopEnvironmentHostAvailable(host: {
  docker_available: boolean;
  healthy: boolean;
}): boolean {
  return host.healthy && host.docker_available;
}

export function describeDesktopEnvironmentHostAvailability(host: {
  docker_available: boolean;
  healthy: boolean;
  last_error: string | null;
}): string {
  const lastError = host.last_error?.trim();
  if (lastError) return lastError;
  if (!host.docker_available) return "docker unavailable";
  if (!host.healthy) return "host unhealthy";
  return "docker ready";
}

export const DesktopEnvironment = z
  .object({
    environment_id: DesktopEnvironmentId,
    host_id: DesktopEnvironmentHostId,
    label: DesktopEnvironmentLabel.optional(),
    image_ref: DesktopEnvironmentImageRef,
    managed_kind: DesktopEnvironmentManagedKind,
    status: DesktopEnvironmentStatus,
    desired_running: z.boolean(),
    node_id: NodeId.nullable(),
    last_seen_at: DateTimeSchema.nullable(),
    last_error: DesktopEnvironmentError.nullable(),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type DesktopEnvironment = z.infer<typeof DesktopEnvironment>;

export const DesktopEnvironmentHostListResponse = z
  .object({
    status: z.literal("ok"),
    hosts: z.array(DesktopEnvironmentHost),
  })
  .strict();
export type DesktopEnvironmentHostListResponse = z.infer<typeof DesktopEnvironmentHostListResponse>;

export const DesktopEnvironmentListResponse = z
  .object({
    status: z.literal("ok"),
    environments: z.array(DesktopEnvironment),
  })
  .strict();
export type DesktopEnvironmentListResponse = z.infer<typeof DesktopEnvironmentListResponse>;

export const DesktopEnvironmentGetResponse = z
  .object({
    status: z.literal("ok"),
    environment: DesktopEnvironment,
  })
  .strict();
export type DesktopEnvironmentGetResponse = z.infer<typeof DesktopEnvironmentGetResponse>;

export const DesktopEnvironmentCreateRequest = z
  .object({
    host_id: DesktopEnvironmentHostId,
    label: DesktopEnvironmentLabel.optional(),
    image_ref: DesktopEnvironmentImageRef.optional(),
    desired_running: z.boolean().optional(),
  })
  .strict();
export type DesktopEnvironmentCreateRequest = z.infer<typeof DesktopEnvironmentCreateRequest>;

export const DesktopEnvironmentUpdateRequest = z
  .object({
    label: DesktopEnvironmentLabel.optional(),
    image_ref: DesktopEnvironmentImageRef.optional(),
    desired_running: z.boolean().optional(),
  })
  .strict();
export type DesktopEnvironmentUpdateRequest = z.infer<typeof DesktopEnvironmentUpdateRequest>;

export const DesktopEnvironmentMutateResponse = z
  .object({
    status: z.literal("ok"),
    environment: DesktopEnvironment,
  })
  .strict();
export type DesktopEnvironmentMutateResponse = z.infer<typeof DesktopEnvironmentMutateResponse>;

export const DesktopEnvironmentDeleteResponse = z
  .object({
    status: z.literal("ok"),
    deleted: z.boolean(),
  })
  .strict();
export type DesktopEnvironmentDeleteResponse = z.infer<typeof DesktopEnvironmentDeleteResponse>;

export const DesktopEnvironmentLogsResponse = z
  .object({
    status: z.literal("ok"),
    environment_id: DesktopEnvironmentId,
    logs: z.array(DesktopEnvironmentLogLine),
  })
  .strict();
export type DesktopEnvironmentLogsResponse = z.infer<typeof DesktopEnvironmentLogsResponse>;

export const DesktopEnvironmentTakeoverSession = z
  .object({
    session_id: z.string().trim().min(1),
    entry_url: z.string().trim().url(),
    expires_at: DateTimeSchema,
  })
  .strict();
export type DesktopEnvironmentTakeoverSession = z.infer<typeof DesktopEnvironmentTakeoverSession>;

export const DesktopEnvironmentTakeoverSessionResponse = z
  .object({
    status: z.literal("ok"),
    session: DesktopEnvironmentTakeoverSession,
  })
  .strict();
export type DesktopEnvironmentTakeoverSessionResponse = z.infer<
  typeof DesktopEnvironmentTakeoverSessionResponse
>;

export const DesktopEnvironmentDefaultsResponse = z
  .object({
    status: z.literal("ok"),
    default_image_ref: DesktopEnvironmentImageRef,
    revision: z.number().int().nonnegative(),
    created_at: DateTimeSchema.nullable(),
    created_by: z.unknown().nullable(),
    reason: z.string().trim().min(1).nullable(),
    reverted_from_revision: z.number().int().positive().nullable(),
  })
  .strict();
export type DesktopEnvironmentDefaultsResponse = z.infer<typeof DesktopEnvironmentDefaultsResponse>;

export const DesktopEnvironmentDefaultsUpdateRequest = z
  .object({
    default_image_ref: DesktopEnvironmentImageRef,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type DesktopEnvironmentDefaultsUpdateRequest = z.infer<
  typeof DesktopEnvironmentDefaultsUpdateRequest
>;
