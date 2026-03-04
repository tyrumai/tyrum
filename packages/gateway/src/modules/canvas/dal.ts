/**
 * Canvas artifact data access layer.
 *
 * Persists HTML/text artifacts to SQLite for sandboxed rendering.
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface CanvasArtifactRow {
  tenant_id: string;
  canvas_artifact_id: string;
  workspace_id: string;
  title: string;
  content_type: string;
  content: string;
  metadata: unknown;
  created_at: string;
}

interface RawCanvasArtifactRow {
  tenant_id: string;
  canvas_artifact_id: string;
  workspace_id: string;
  title: string;
  content_type: string;
  content: string;
  metadata_json: string;
  created_at: string | Date;
}

function toArtifactRow(raw: RawCanvasArtifactRow): CanvasArtifactRow {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(raw.metadata_json) as unknown;
  } catch {
    // Intentional: treat invalid JSON metadata as an empty object.
  }
  return {
    tenant_id: raw.tenant_id,
    canvas_artifact_id: raw.canvas_artifact_id,
    workspace_id: raw.workspace_id,
    title: raw.title,
    content_type: raw.content_type,
    content: raw.content,
    metadata,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at,
  };
}

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export interface PublishArtifactParams {
  tenantId: string;
  workspaceId: string;
  title: string;
  contentType: string;
  content: string;
  metadata?: unknown;
  links?: Array<{
    parentKind: "plan" | "session" | "work_item" | "execution_run";
    parentId: string;
  }>;
}

export class CanvasDal {
  constructor(private readonly db: SqlDb) {}

  /** Store a new canvas artifact. Returns the created row. */
  async publish(params: PublishArtifactParams): Promise<CanvasArtifactRow> {
    if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
      throw new Error(
        `Invalid content_type: ${params.contentType}. Allowed: text/html, text/plain`,
      );
    }

    const id = randomUUID();
    const metadataJson = JSON.stringify(params.metadata ?? {});
    const nowIso = new Date().toISOString();

    const row = await this.db.get<RawCanvasArtifactRow>(
      `INSERT INTO canvas_artifacts (
         tenant_id,
         canvas_artifact_id,
         workspace_id,
         title,
         content_type,
         content,
         metadata_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.tenantId,
        id,
        params.workspaceId,
        params.title,
        params.contentType,
        params.content,
        metadataJson,
        nowIso,
      ],
    );
    if (!row) {
      throw new Error("failed to publish canvas artifact");
    }

    if (params.links && params.links.length > 0) {
      for (const link of params.links) {
        await this.db.run(
          `INSERT INTO canvas_artifact_links (tenant_id, canvas_artifact_id, parent_kind, parent_id, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (tenant_id, canvas_artifact_id, parent_kind, parent_id) DO NOTHING`,
          [params.tenantId, id, link.parentKind, link.parentId, nowIso],
        );
      }
    }

    return toArtifactRow(row);
  }

  /** Get a single artifact by id. */
  async getById(params: {
    tenantId: string;
    canvasArtifactId: string;
  }): Promise<CanvasArtifactRow | undefined> {
    const row = await this.db.get<RawCanvasArtifactRow>(
      "SELECT * FROM canvas_artifacts WHERE tenant_id = ? AND canvas_artifact_id = ?",
      [params.tenantId, params.canvasArtifactId],
    );

    return row ? toArtifactRow(row) : undefined;
  }

  /** List all artifacts linked to a given parent, ordered by creation time. */
  async listByParent(params: {
    tenantId: string;
    parentKind: "plan" | "session" | "work_item" | "execution_run";
    parentId: string;
  }): Promise<CanvasArtifactRow[]> {
    const rows = await this.db.all<RawCanvasArtifactRow>(
      `SELECT a.*
       FROM canvas_artifacts a
       JOIN canvas_artifact_links l
         ON l.tenant_id = a.tenant_id AND l.canvas_artifact_id = a.canvas_artifact_id
       WHERE l.tenant_id = ? AND l.parent_kind = ? AND l.parent_id = ?
       ORDER BY a.created_at ASC, a.canvas_artifact_id ASC`,
      [params.tenantId, params.parentKind, params.parentId],
    );

    return rows.map(toArtifactRow);
  }

  /** List most recent artifacts, newest first. */
  async listRecent(params: {
    tenantId: string;
    workspaceId?: string;
    limit?: number;
  }): Promise<CanvasArtifactRow[]> {
    const limit = Math.max(1, Math.min(500, params.limit ?? 50));
    const where: string[] = ["tenant_id = ?"];
    const values: unknown[] = [params.tenantId];

    if (params.workspaceId) {
      where.push("workspace_id = ?");
      values.push(params.workspaceId);
    }

    const rows = await this.db.all<RawCanvasArtifactRow>(
      `SELECT *
       FROM canvas_artifacts
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ${String(limit)}`,
      values,
    );
    return rows.map(toArtifactRow);
  }
}
