import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

export const ArtifactId = UuidSchema;
export type ArtifactId = z.infer<typeof ArtifactId>;

export const ArtifactKind = z.enum([
  "screenshot",
  "diff",
  "log",
  "dom_snapshot",
  "http_trace",
  "receipt",
  "file",
  "other",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "sha256 must be 64 hex chars");
export type Sha256Hex = z.infer<typeof Sha256Hex>;

/**
 * Canonical artifact URI used inside Tyrum events/logs.
 *
 * This is intentionally *not* a standard URL; it is an opaque internal reference.
 */
export const ArtifactUri = z
  .string()
  .regex(
    /^artifact:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "artifact uri must be artifact://<uuid>",
  );
export type ArtifactUri = z.infer<typeof ArtifactUri>;

export const ArtifactRef = z
  .object({
    artifact_id: ArtifactId,
    uri: ArtifactUri,
    kind: ArtifactKind,
    created_at: DateTimeSchema,
    mime_type: z.string().trim().min(1).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    sha256: Sha256Hex.optional(),
    labels: z.array(z.string().trim().min(1)).default([]),
    metadata: z.unknown().optional(),
  })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRef>;

