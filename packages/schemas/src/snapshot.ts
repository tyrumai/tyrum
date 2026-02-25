import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { ArtifactSensitivity } from "./policy-bundle.js";

export const SnapshotFormatV1 = z.literal("tyrum.snapshot.v1");
export type SnapshotFormatV1 = z.infer<typeof SnapshotFormatV1>;

export const SnapshotFormatV2 = z.literal("tyrum.snapshot.v2");
export type SnapshotFormatV2 = z.infer<typeof SnapshotFormatV2>;

export const SnapshotFormat = z.union([SnapshotFormatV1, SnapshotFormatV2]);
export type SnapshotFormat = z.infer<typeof SnapshotFormat>;

export const SnapshotTable = z
  .object({
    columns: z.array(z.string().trim().min(1)).min(1),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
export type SnapshotTable = z.infer<typeof SnapshotTable>;

export const SnapshotArtifactBytesInclusionPolicy = z.discriminatedUnion("included", [
  z
    .object({
      included: z.literal(false),
      included_sensitivity: z.array(ArtifactSensitivity).length(0),
    })
    .strict(),
  z
    .object({
      included: z.literal(true),
      included_sensitivity: z.array(ArtifactSensitivity).min(1),
    })
    .strict(),
]);
export type SnapshotArtifactBytesInclusionPolicy = z.infer<typeof SnapshotArtifactBytesInclusionPolicy>;

export const SnapshotArtifactRetentionMetadata = z
  .object({
    execution_artifacts: z
      .object({
        included: z.boolean(),
        has_retention_expires_at: z.boolean(),
        has_bytes_deleted_at: z.boolean(),
        has_bytes_deleted_reason: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type SnapshotArtifactRetentionMetadata = z.infer<typeof SnapshotArtifactRetentionMetadata>;

export const SnapshotArtifactsMetadata = z
  .object({
    bytes: SnapshotArtifactBytesInclusionPolicy,
    retention: SnapshotArtifactRetentionMetadata,
  })
  .strict();
export type SnapshotArtifactsMetadata = z.infer<typeof SnapshotArtifactsMetadata>;

export const SnapshotBundleV1 = z
  .object({
    format: SnapshotFormatV1,
    exported_at: DateTimeSchema,
    gateway_version: z.string().trim().min(1).optional(),
    db_kind: z.enum(["sqlite", "postgres"]).optional(),
    tables: z.record(z.string().trim().min(1), SnapshotTable),
  })
  .strict();
export type SnapshotBundleV1 = z.infer<typeof SnapshotBundleV1>;

export const SnapshotBundleV2 = z
  .object({
    format: SnapshotFormatV2,
    exported_at: DateTimeSchema,
    gateway_version: z.string().trim().min(1).optional(),
    db_kind: z.enum(["sqlite", "postgres"]).optional(),
    artifacts: SnapshotArtifactsMetadata,
    tables: z.record(z.string().trim().min(1), SnapshotTable),
  })
  .strict();
export type SnapshotBundleV2 = z.infer<typeof SnapshotBundleV2>;

export const SnapshotBundle = z.discriminatedUnion("format", [SnapshotBundleV1, SnapshotBundleV2]);
export type SnapshotBundle = z.infer<typeof SnapshotBundle>;

export const SnapshotImportRequest = z
  .object({
    confirm: z.literal("IMPORT"),
    bundle: SnapshotBundle,
  })
  .strict();
export type SnapshotImportRequest = z.infer<typeof SnapshotImportRequest>;
