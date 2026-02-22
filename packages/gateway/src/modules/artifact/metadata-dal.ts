/**
 * Durable artifact metadata -- stores metadata alongside blob storage.
 */

import type { SqlDb } from "../../statestore/types.js";
import { resolveAgentId, withAgentScope } from "../agent/agent-scope.js";

export interface ArtifactMetadataRow {
  artifact_id: string;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  kind: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uri: string;
  labels: string[];
  agent_id: string;
  created_at: string;
  metadata: unknown | null;
}

interface RawArtifactMetadataRow {
  artifact_id: string;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  kind: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uri: string;
  labels_json: string;
  agent_id: string;
  created_at: string | Date;
  metadata_json: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toArtifactMetadataRow(raw: RawArtifactMetadataRow): ArtifactMetadataRow {
  let labels: string[] = [];
  try {
    labels = JSON.parse(raw.labels_json) as string[];
  } catch {
    // leave as empty array
  }
  let metadata: unknown | null = null;
  if (raw.metadata_json !== null) {
    try {
      metadata = JSON.parse(raw.metadata_json) as unknown;
    } catch {
      // leave as null
    }
  }
  return {
    artifact_id: raw.artifact_id,
    run_id: raw.run_id,
    step_id: raw.step_id,
    attempt_id: raw.attempt_id,
    kind: raw.kind,
    mime_type: raw.mime_type,
    size_bytes: raw.size_bytes !== null ? Number(raw.size_bytes) : null,
    sha256: raw.sha256,
    uri: raw.uri,
    labels,
    agent_id: raw.agent_id,
    created_at: normalizeTime(raw.created_at),
    metadata,
  };
}

export class ArtifactMetadataDal {
  constructor(private readonly db: SqlDb) {}

  async insert(entry: {
    artifactId: string;
    runId?: string;
    stepId?: string;
    attemptId?: string;
    kind: string;
    mimeType?: string;
    sizeBytes?: number;
    sha256?: string;
    uri: string;
    labels?: string[];
    metadata?: unknown;
    agentId?: string;
  }): Promise<ArtifactMetadataRow> {
    const nowIso = new Date().toISOString();
    const labelsJson = JSON.stringify(entry.labels ?? []);
    const metadataJson = entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null;

    const row = await this.db.get<RawArtifactMetadataRow>(
      `INSERT INTO artifact_metadata (artifact_id, run_id, step_id, attempt_id, kind, mime_type, size_bytes, sha256, uri, labels_json, created_at, metadata_json, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        entry.artifactId,
        entry.runId ?? null,
        entry.stepId ?? null,
        entry.attemptId ?? null,
        entry.kind,
        entry.mimeType ?? null,
        entry.sizeBytes ?? null,
        entry.sha256 ?? null,
        entry.uri,
        labelsJson,
        nowIso,
        metadataJson,
        resolveAgentId(entry.agentId),
      ],
    );
    if (!row) {
      throw new Error("artifact metadata insert failed");
    }
    return toArtifactMetadataRow(row);
  }

  async getById(artifactId: string, agentId?: string): Promise<ArtifactMetadataRow | undefined> {
    const scoped = withAgentScope(
      "SELECT * FROM artifact_metadata WHERE artifact_id = ?",
      agentId ?? "",
      [artifactId],
    );
    const row = await this.db.get<RawArtifactMetadataRow>(scoped.query, scoped.params);
    return row ? toArtifactMetadataRow(row) : undefined;
  }

  async listByRun(runId: string, agentId?: string): Promise<ArtifactMetadataRow[]> {
    const scoped = withAgentScope(
      "SELECT * FROM artifact_metadata WHERE run_id = ?",
      agentId ?? "",
      [runId],
    );
    const rows = await this.db.all<RawArtifactMetadataRow>(
      `${scoped.query} ORDER BY created_at ASC`,
      scoped.params,
    );
    return rows.map(toArtifactMetadataRow);
  }

  async listByStep(stepId: string, agentId?: string): Promise<ArtifactMetadataRow[]> {
    const scoped = withAgentScope(
      "SELECT * FROM artifact_metadata WHERE step_id = ?",
      agentId ?? "",
      [stepId],
    );
    const rows = await this.db.all<RawArtifactMetadataRow>(
      `${scoped.query} ORDER BY created_at ASC`,
      scoped.params,
    );
    return rows.map(toArtifactMetadataRow);
  }
}
