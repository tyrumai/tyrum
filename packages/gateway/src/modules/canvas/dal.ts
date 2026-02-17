/**
 * Canvas artifact data access layer.
 *
 * Persists HTML/text artifacts to SQLite for sandboxed rendering.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

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
  created_at: string;
}

function toArtifactRow(raw: RawCanvasArtifactRow): CanvasArtifactRow {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(raw.metadata_json) as unknown;
  } catch {
    // leave as empty object
  }
  return {
    id: raw.id,
    plan_id: raw.plan_id,
    title: raw.title,
    content_type: raw.content_type,
    html_content: raw.html_content,
    metadata,
    created_at: raw.created_at,
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
  constructor(private readonly db: Database.Database) {}

  /** Store a new canvas artifact. Returns the created row. */
  publish(params: PublishArtifactParams): CanvasArtifactRow {
    if (!ALLOWED_CONTENT_TYPES.has(params.contentType)) {
      throw new Error(
        `Invalid content_type: ${params.contentType}. Allowed: text/html, text/plain`,
      );
    }

    const id = randomUUID();
    const metadataJson = JSON.stringify(params.metadata ?? {});

    this.db
      .prepare(
        `INSERT INTO canvas_artifacts (id, plan_id, title, content_type, html_content, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.planId ?? null,
        params.title,
        params.contentType,
        params.htmlContent,
        metadataJson,
      );

    const row = this.db
      .prepare("SELECT * FROM canvas_artifacts WHERE id = ?")
      .get(id) as RawCanvasArtifactRow;

    return toArtifactRow(row);
  }

  /** Get a single artifact by id. */
  getById(id: string): CanvasArtifactRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM canvas_artifacts WHERE id = ?")
      .get(id) as RawCanvasArtifactRow | undefined;

    return row ? toArtifactRow(row) : undefined;
  }

  /** List all artifacts for a given plan, ordered by creation time. */
  listByPlan(planId: string): CanvasArtifactRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM canvas_artifacts WHERE plan_id = ? ORDER BY created_at ASC",
      )
      .all(planId) as RawCanvasArtifactRow[];

    return rows.map(toArtifactRow);
  }
}
