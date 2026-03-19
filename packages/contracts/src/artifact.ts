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

export const ArtifactMediaClass = z.enum(["image", "audio", "video", "document", "other"]);
export type ArtifactMediaClass = z.infer<typeof ArtifactMediaClass>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/i, "sha256 must be 64 hex chars");
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
    external_url: z.string().url(),
    kind: ArtifactKind,
    media_class: ArtifactMediaClass,
    created_at: DateTimeSchema,
    filename: z.string().trim().min(1),
    mime_type: z.string().trim().min(1).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    sha256: Sha256Hex.optional(),
    labels: z.array(z.string().trim().min(1)).default([]),
    metadata: z.unknown().optional(),
  })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRef>;

export function artifactMediaClassFromMimeType(
  mimeType: string | undefined,
  filename?: string | undefined,
): ArtifactMediaClass {
  const mime = mimeType?.trim().toLowerCase();
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("video/")) return "video";
  if (
    mime === "application/pdf" ||
    mime?.startsWith("text/") ||
    mime === "application/json" ||
    mime?.endsWith("+json") ||
    mime === "application/xml" ||
    mime?.endsWith("+xml")
  ) {
    return "document";
  }

  const normalizedFilename = filename?.trim().toLowerCase();
  if (
    normalizedFilename?.endsWith(".txt") ||
    normalizedFilename?.endsWith(".md") ||
    normalizedFilename?.endsWith(".json") ||
    normalizedFilename?.endsWith(".xml") ||
    normalizedFilename?.endsWith(".csv") ||
    normalizedFilename?.endsWith(".pdf")
  ) {
    return "document";
  }

  return "other";
}

function artifactFileExtensionFromMimeType(mimeType: string | undefined): string | undefined {
  const mime = mimeType?.trim().toLowerCase();
  if (!mime) {
    return undefined;
  }
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "audio/mpeg":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    case "video/mp4":
      return "mp4";
    case "application/pdf":
      return "pdf";
    case "application/json":
      return "json";
    case "application/xml":
      return "xml";
    case "text/plain":
      return "txt";
    case "text/markdown":
      return "md";
    case "text/html":
      return "html";
    case "text/csv":
      return "csv";
    default:
      return undefined;
  }
}

function artifactFileExtensionFromKind(kind: ArtifactKind): string {
  switch (kind) {
    case "screenshot":
      return "png";
    case "diff":
      return "patch";
    case "log":
      return "txt";
    case "dom_snapshot":
      return "html";
    case "http_trace":
      return "json";
    case "receipt":
      return "txt";
    default:
      return "bin";
  }
}

export function artifactFilenameFromMetadata(input: {
  artifactId: string;
  kind: ArtifactKind;
  filename?: string | undefined;
  mimeType?: string | undefined;
}): string {
  const explicitFilename = input.filename?.trim();
  if (explicitFilename) {
    return explicitFilename;
  }

  const extension =
    artifactFileExtensionFromMimeType(input.mimeType) ?? artifactFileExtensionFromKind(input.kind);
  return `artifact-${input.artifactId}.${extension}`;
}
