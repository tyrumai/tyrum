/**
 * Canvas artifact data access layer.
 *
 * Persists HTML/text artifacts to SQLite for sandboxed rendering.
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface CanvasArtifactRow {
  id: string;
  plan_id: string | null;
  title: string;
  content_type: string;
  html_content: string;
  metadata: unknown;
  created_at: string;
}

interface RawCanvasArtifactRow {
  id: string;
  plan_id: string | null;
  title: string;
  content_type: string;
  html_content: string;
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
    id: raw.id,
    plan_id: raw.plan_id,
    title: raw.title,
    content_type: raw.content_type,
    html_content: raw.html_content,
    metadata,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at,
  };
}

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export interface PublishArtifactParams {
  planId?: string;
  title: string;
  contentType: string;
  htmlContent: string;
  metadata?: unknown;
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
      `INSERT INTO canvas_artifacts (id, plan_id, title, content_type, html_content, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        params.planId ?? null,
        params.title,
        params.contentType,
        params.htmlContent,
        metadataJson,
        nowIso,
      ],
    );
    if (!row) {
      throw new Error("failed to publish canvas artifact");
    }
    return toArtifactRow(row);
  }

  /** Get a single artifact by id. */
  async getById(id: string): Promise<CanvasArtifactRow | undefined> {
    const row = await this.db.get<RawCanvasArtifactRow>(
      "SELECT * FROM canvas_artifacts WHERE id = ?",
      [id],
    );

    return row ? toArtifactRow(row) : undefined;
  }

  /** List all artifacts for a given plan, ordered by creation time. */
  async listByPlan(planId: string): Promise<CanvasArtifactRow[]> {
    const rows = await this.db.all<RawCanvasArtifactRow>(
      "SELECT * FROM canvas_artifacts WHERE plan_id = ? ORDER BY created_at ASC",
      [planId],
    );

    return rows.map(toArtifactRow);
  }

  /** List most recent artifacts, newest first. */
  async listRecent(limit = 50): Promise<CanvasArtifactRow[]> {
    const rows = await this.db.all<RawCanvasArtifactRow>(
      "SELECT * FROM canvas_artifacts ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
    return rows.map(toArtifactRow);
  }
}
