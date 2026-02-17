/**
 * Canvas artifact routes — publish, serve, and inspect HTML artifacts.
 */

import { Hono } from "hono";
import type { CanvasDal } from "../modules/canvas/dal.js";

const CSP_HEADER = "default-src 'self'; script-src 'none'";
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export function createCanvasRoutes(canvasDal: CanvasDal): Hono {
  const app = new Hono();

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

    const artifact = canvasDal.publish({
      planId: body.plan_id,
      title: body.title,
      contentType: body.content_type,
      htmlContent: body.html_content,
      metadata: body.metadata,
    });

    return c.json({ id: artifact.id, created_at: artifact.created_at }, 201);
  });

  /** Serve the artifact HTML with CSP headers. */
  app.get("/canvas/:id", (c) => {
    const id = c.req.param("id");
    const artifact = canvasDal.getById(id);

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
  app.get("/canvas/:id/meta", (c) => {
    const id = c.req.param("id");
    const artifact = canvasDal.getById(id);

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
