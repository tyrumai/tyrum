/**
 * Canvas artifact routes — publish, serve, and inspect HTML artifacts.
 */

import { Hono } from "hono";
import type { CanvasDal } from "../modules/canvas/dal.js";

const CSP_HEADER = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'";
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export function createCanvasRoutes(canvasDal: CanvasDal): Hono {
  const app = new Hono();

  /** List recent canvas artifacts (metadata only). */
  app.get("/canvas", async (c) => {
    const limitParam = c.req.query("limit");
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 500);
      }
    }

    const artifacts = await canvasDal.listRecent(limit);
    return c.json({
      artifacts: artifacts.map((a) => ({
        id: a.id,
        plan_id: a.plan_id,
        title: a.title,
        content_type: a.content_type,
        metadata: a.metadata,
        created_at: a.created_at,
      })),
    });
  });

  /** Publish a new canvas artifact. */
  app.post("/canvas/publish", async (c) => {
    const body = (await c.req.json()) as {
      plan_id?: string;
      title?: string;
      content_type?: string;
      html_content?: string;
      metadata?: unknown;
    };

    if (!body.title || !body.content_type || !body.html_content) {
      return c.json(
        {
          error: "invalid_request",
          message: "title, content_type, and html_content are required",
        },
        400,
      );
    }

    if (!ALLOWED_CONTENT_TYPES.has(body.content_type)) {
      return c.json(
        {
          error: "invalid_request",
          message: `content_type must be one of: text/html, text/plain`,
        },
        400,
      );
    }

    const artifact = await canvasDal.publish({
      planId: body.plan_id,
      title: body.title,
      contentType: body.content_type,
      htmlContent: body.html_content,
      metadata: body.metadata,
    });

    return c.json({ id: artifact.id, created_at: artifact.created_at }, 201);
  });

  /** Serve the artifact HTML with CSP headers. */
  app.get("/canvas/:id", async (c) => {
    const id = c.req.param("id");
    const artifact = await canvasDal.getById(id);

    if (!artifact) {
      return c.json(
        { error: "not_found", message: `artifact ${id} not found` },
        404,
      );
    }

    c.header("Content-Security-Policy", CSP_HEADER);
    c.header("Content-Type", `${artifact.content_type}; charset=utf-8`);
    return c.body(artifact.html_content);
  });

  /** Metadata-only endpoint. */
  app.get("/canvas/:id/meta", async (c) => {
    const id = c.req.param("id");
    const artifact = await canvasDal.getById(id);

    if (!artifact) {
      return c.json(
        { error: "not_found", message: `artifact ${id} not found` },
        404,
      );
    }

    return c.json({
      id: artifact.id,
      plan_id: artifact.plan_id,
      title: artifact.title,
      content_type: artifact.content_type,
      metadata: artifact.metadata,
      created_at: artifact.created_at,
    });
  });

  return app;
}
