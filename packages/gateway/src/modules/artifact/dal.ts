import {
  artifactFilenameFromMetadata,
  ArtifactKind,
  ArtifactMediaClass,
  ArtifactRef,
  artifactMediaClassFromMimeType,
} from "@tyrum/contracts";
import type { TyrumUIMessage, ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { safeJsonParse } from "../../utils/json.js";

export type ArtifactLinkParentKind =
  | "execution_run"
  | "execution_step"
  | "execution_attempt"
  | "chat_session"
  | "chat_message";

export type ArtifactRow = {
  tenant_id: string;
  artifact_id: string;
  access_id: string;
  workspace_id: string;
  agent_id: string | null;
  kind: string;
  uri: string;
  external_url: string;
  media_class: string | null;
  filename: string | null;
  created_at: string | Date;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  labels_json: string;
  metadata_json: string;
  sensitivity: string;
  policy_snapshot_id: string | null;
  retention_expires_at: string | Date | null;
  bytes_deleted_at: string | Date | null;
  bytes_deleted_reason: string | null;
};

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))];
}

function artifactMediaClassFromRow(
  row: Pick<ArtifactRow, "media_class" | "mime_type" | "filename">,
) {
  const parsedMediaClass = ArtifactMediaClass.safeParse(row.media_class?.trim());
  return parsedMediaClass.success
    ? parsedMediaClass.data
    : artifactMediaClassFromMimeType(row.mime_type ?? undefined, row.filename ?? undefined);
}

export function artifactAccessIdForRef(artifact: Pick<ArtifactRefT, "artifact_id">): string {
  return artifact.artifact_id;
}

export function rowToArtifactRef(row: ArtifactRow): ArtifactRefT | undefined {
  const labels = safeJsonParse(row.labels_json, [] as unknown[]);
  const metadata = safeJsonParse(row.metadata_json, undefined as unknown);
  const kindCandidate = ArtifactKind.safeParse(row.kind);
  if (!kindCandidate.success) {
    return undefined;
  }
  const filename = artifactFilenameFromMetadata({
    artifactId: row.artifact_id,
    kind: kindCandidate.data,
    filename: row.filename ?? undefined,
    mimeType: row.mime_type ?? undefined,
  });

  const candidate = {
    artifact_id: row.artifact_id,
    uri: row.uri,
    external_url: row.external_url,
    kind: kindCandidate.data,
    media_class: artifactMediaClassFromRow(row),
    created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
    filename,
    mime_type: row.mime_type ?? undefined,
    size_bytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string") : [],
    metadata,
  };

  const parsed = ArtifactRef.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export async function getArtifactRowsByIds(
  db: SqlDb,
  tenantId: string,
  artifactIds: readonly string[],
): Promise<ArtifactRow[]> {
  const uniqueIds = uniqueStrings(artifactIds);
  if (uniqueIds.length === 0) {
    return [];
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  return await db.all<ArtifactRow>(
    `SELECT *
     FROM artifacts
     WHERE tenant_id = ?
       AND artifact_id IN (${placeholders})
     ORDER BY created_at ASC, artifact_id ASC`,
    [tenantId, ...uniqueIds],
  );
}

export async function insertArtifactRecordTx(
  tx: SqlDb,
  input: {
    artifact: ArtifactRefT;
    tenantId: string;
    workspaceId: string;
    agentId: string | null;
    sensitivity: "normal" | "sensitive";
    policySnapshotId: string | null;
    labelsJson?: string;
    metadataJson?: string;
  },
): Promise<{ inserted: boolean; accessId: string }> {
  const accessId = artifactAccessIdForRef(input.artifact);
  const labelsJson = input.labelsJson ?? JSON.stringify(input.artifact.labels ?? []);
  const metadataJson = input.metadataJson ?? JSON.stringify(input.artifact.metadata ?? {});

  const insertResult = await tx.run(
    `INSERT INTO artifacts (
       tenant_id,
       artifact_id,
       access_id,
       workspace_id,
       agent_id,
       kind,
       uri,
       external_url,
       media_class,
       filename,
       created_at,
       mime_type,
       size_bytes,
       sha256,
       labels_json,
       metadata_json,
       sensitivity,
       policy_snapshot_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, artifact_id) DO NOTHING`,
    [
      input.tenantId,
      input.artifact.artifact_id,
      accessId,
      input.workspaceId,
      input.agentId,
      input.artifact.kind,
      input.artifact.uri,
      input.artifact.external_url,
      input.artifact.media_class,
      input.artifact.filename,
      input.artifact.created_at,
      input.artifact.mime_type ?? null,
      input.artifact.size_bytes ?? null,
      input.artifact.sha256 ?? null,
      labelsJson,
      metadataJson,
      input.sensitivity,
      input.policySnapshotId,
    ],
  );

  await tx.run(
    `INSERT INTO artifact_access (
       tenant_id,
       access_id,
       artifact_id,
       created_at
     )
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id, artifact_id) DO NOTHING`,
    [input.tenantId, accessId, input.artifact.artifact_id, input.artifact.created_at],
  );

  return {
    inserted: insertResult.changes > 0,
    accessId,
  };
}

export async function linkArtifactTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    artifactId: string;
    parentKind: ArtifactLinkParentKind;
    parentId: string;
    createdAt?: string;
  },
): Promise<void> {
  await tx.run(
    `INSERT INTO artifact_links (
       tenant_id,
       artifact_id,
       parent_kind,
       parent_id,
       created_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, artifact_id, parent_kind, parent_id) DO NOTHING`,
    [
      input.tenantId,
      input.artifactId,
      input.parentKind,
      input.parentId,
      input.createdAt ?? new Date().toISOString(),
    ],
  );
}

export function extractArtifactIdFromUrl(url: string): string | undefined {
  const trimmed = url.trim();
  const artifactMatch = /^artifact:\/\/([0-9a-f-]{36})$/i.exec(trimmed);
  if (artifactMatch) {
    return artifactMatch[1];
  }

  try {
    const parsed = new URL(trimmed, "http://artifact.local");
    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length !== 2 || segments[0] !== "a") {
      return undefined;
    }
    return segments[1];
  } catch {
    // Intentional: invalid URLs should simply fail artifact extraction.
    return undefined;
  }
}

function collectArtifactIdsFromMessage(message: TyrumUIMessage): string[] {
  const artifactIds: string[] = [];
  for (const part of message.parts) {
    if (part.type !== "file" || typeof part["url"] !== "string") {
      continue;
    }
    const artifactId = extractArtifactIdFromUrl(part["url"]);
    if (artifactId) {
      artifactIds.push(artifactId);
    }
  }
  return uniqueStrings(artifactIds);
}

export async function replaceSessionArtifactLinksTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    sessionId: string;
    previousMessages: readonly TyrumUIMessage[];
    nextMessages: readonly TyrumUIMessage[];
  },
): Promise<void> {
  await tx.run(
    `DELETE FROM artifact_links
     WHERE tenant_id = ?
       AND parent_kind = 'chat_session'
       AND parent_id = ?`,
    [input.tenantId, input.sessionId],
  );

  const previousMessageIds = uniqueStrings(
    input.previousMessages
      .map((message) => message.id?.trim() ?? "")
      .filter((messageId) => messageId.length > 0),
  );
  if (previousMessageIds.length > 0) {
    const placeholders = previousMessageIds.map(() => "?").join(", ");
    await tx.run(
      `DELETE FROM artifact_links
       WHERE tenant_id = ?
         AND parent_kind = 'chat_message'
         AND parent_id IN (${placeholders})`,
      [input.tenantId, ...previousMessageIds],
    );
  }

  const sessionArtifactIds = new Set<string>();
  for (const message of input.nextMessages) {
    const artifactIds = collectArtifactIdsFromMessage(message);
    for (const artifactId of artifactIds) {
      sessionArtifactIds.add(artifactId);
      if (typeof message.id === "string" && message.id.trim().length > 0) {
        await linkArtifactTx(tx, {
          tenantId: input.tenantId,
          artifactId,
          parentKind: "chat_message",
          parentId: message.id,
        });
      }
    }
  }

  for (const artifactId of sessionArtifactIds) {
    await linkArtifactTx(tx, {
      tenantId: input.tenantId,
      artifactId,
      parentKind: "chat_session",
      parentId: input.sessionId,
    });
  }
}
