import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const SnapshotFormat = z.literal("tyrum.snapshot.v1");
export type SnapshotFormat = z.infer<typeof SnapshotFormat>;

export const SnapshotTable = z
  .object({
    columns: z.array(z.string().trim().min(1)).min(1),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();
export type SnapshotTable = z.infer<typeof SnapshotTable>;

export const SnapshotBundle = z
  .object({
    format: SnapshotFormat,
    exported_at: DateTimeSchema,
    gateway_version: z.string().trim().min(1).optional(),
    db_kind: z.enum(["sqlite", "postgres"]).optional(),
    tables: z.record(z.string().trim().min(1), SnapshotTable),
  })
  .strict();
export type SnapshotBundle = z.infer<typeof SnapshotBundle>;

export const SnapshotImportRequest = z
  .object({
    confirm: z.literal("IMPORT"),
    bundle: SnapshotBundle,
  })
  .strict();
export type SnapshotImportRequest = z.infer<typeof SnapshotImportRequest>;

