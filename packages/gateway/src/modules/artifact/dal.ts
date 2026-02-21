import type { ArtifactRef as ArtifactRefT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export type ArtifactSensitivity = "normal" | "sensitive";

export interface ArtifactRow {
  artifact_id: string;
  agent_id: string;
  workspace_id: string;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  uri: string;
  kind: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  labels: string[];
  sensitivity: ArtifactSensitivity;
  metadata: unknown | null;
  fetched_count: number;
  last_fetched_at: string | null;
  created_by: string | null;
}

interface RawArtifactRow {
  artifact_id: string;
  agent_id: string;
  workspace_id: string;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  uri: string;
  kind: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  labels_json: string;
  sensitivity: string;
  metadata_json: string | null;
  fetched_count: number;
  last_fetched_at: string | null;
  created_by: string | null;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseLabels(value: string): string[] {
  const parsed = parseJson<unknown>(value);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function normalizeSensitivity(value: string): ArtifactSensitivity {
  return value === "sensitive" ? "sensitive" : "normal";
}

function toArtifactRow(raw: RawArtifactRow): ArtifactRow {
  return {
    artifact_id: raw.artifact_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    run_id: raw.run_id,
    step_id: raw.step_id,
    attempt_id: raw.attempt_id,
    uri: raw.uri,
    kind: raw.kind,
    created_at: raw.created_at,
    mime_type: raw.mime_type,
    size_bytes: raw.size_bytes,
    sha256: raw.sha256,
    labels: parseLabels(raw.labels_json),
    sensitivity: normalizeSensitivity(raw.sensitivity),
    metadata: parseJson(raw.metadata_json),
    fetched_count: raw.fetched_count,
    last_fetched_at: raw.last_fetched_at,
    created_by: raw.created_by,
  };
}

export class ArtifactDal {
  constructor(private readonly db: SqlDb) {}

  async upsertMetadata(input: {
    ref: ArtifactRefT;
    agentId: string;
    workspaceId: string;
    runId?: string | null;
    stepId?: string | null;
    attemptId?: string | null;
    sensitivity?: ArtifactSensitivity;
    createdBy?: string | null;
  }): Promise<void> {
    const labelsJson = JSON.stringify(input.ref.labels ?? []);
    const metadataJson = input.ref.metadata !== undefined ? JSON.stringify(input.ref.metadata) : null;
    const sensitivity = input.sensitivity ?? "normal";

    await this.db.run(
      `INSERT INTO artifacts (
         artifact_id,
         agent_id,
         workspace_id,
         run_id,
         step_id,
         attempt_id,
         uri,
         kind,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         sensitivity,
         metadata_json,
         created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (artifact_id) DO UPDATE SET
         agent_id = excluded.agent_id,
         workspace_id = excluded.workspace_id,
         run_id = excluded.run_id,
         step_id = excluded.step_id,
         attempt_id = excluded.attempt_id,
         uri = excluded.uri,
         kind = excluded.kind,
         created_at = excluded.created_at,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         sha256 = excluded.sha256,
         labels_json = excluded.labels_json,
         sensitivity = excluded.sensitivity,
         metadata_json = excluded.metadata_json,
         created_by = excluded.created_by`,
      [
        input.ref.artifact_id,
        input.agentId,
        input.workspaceId,
        input.runId ?? null,
        input.stepId ?? null,
        input.attemptId ?? null,
        input.ref.uri,
        input.ref.kind,
        input.ref.created_at,
        input.ref.mime_type ?? null,
        input.ref.size_bytes ?? null,
        input.ref.sha256 ?? null,
        labelsJson,
        sensitivity,
        metadataJson,
        input.createdBy ?? null,
      ],
    );
  }

  async getById(artifactId: string): Promise<ArtifactRow | undefined> {
    const row = await this.db.get<RawArtifactRow>(
      "SELECT * FROM artifacts WHERE artifact_id = ?",
      [artifactId],
    );
    return row ? toArtifactRow(row) : undefined;
  }

  async recordFetched(artifactId: string, nowIso: string): Promise<void> {
    await this.db.run(
      `UPDATE artifacts
       SET fetched_count = fetched_count + 1,
           last_fetched_at = ?
       WHERE artifact_id = ?`,
      [nowIso, artifactId],
    );
  }
}

