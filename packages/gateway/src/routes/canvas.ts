/**
 * Canvas artifact routes — publish, serve, and inspect HTML artifacts.
 */

import { Hono } from "hono";
import type { CanvasDal } from "../modules/canvas/dal.js";
import type { IdentityScopeDal } from "../modules/identity/scope.js";
import { DEFAULT_WORKSPACE_KEY } from "../modules/identity/scope.js";
import { requireTenantId } from "../modules/auth/claims.js";

const CSP_HEADER = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'";
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export function createCanvasRoutes(deps: {
  canvasDal: CanvasDal;
  identityScopeDal: IdentityScopeDal;
}): Hono {
  const app = new Hono();

  /** Publish a new canvas artifact. */
  app.post("/canvas/publish", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as {
      title?: string;
      content_type?: string;
      content?: string;
      metadata?: unknown;
      links?: Array<{ parent_kind?: string; parent_id?: string }>;
    };

    if (!body.title || !body.content_type || !body.content) {
      return c.json(
        {
          error: "invalid_request",
          message: "title, content_type, and content are required",
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

    type CanvasParentKind = "plan" | "session" | "work_item" | "execution_run";
    const links: { parentKind: CanvasParentKind; parentId: string }[] =
      body.links?.flatMap((link: any) => {
        const parentKind = typeof link.parent_kind === "string" ? link.parent_kind.trim() : "";
        const parentId = typeof link.parent_id === "string" ? link.parent_id.trim() : "";
        if (
          (parentKind === "plan" ||
            parentKind === "session" ||
            parentKind === "work_item" ||
            parentKind === "execution_run") &&
          parentId.length > 0
        ) {
          return [{ parentKind: parentKind as CanvasParentKind, parentId }];
        }
        return [];
      }) ?? [];

    const workspaceId = await deps.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );

    const artifact = await deps.canvasDal.publish({
      tenantId,
      workspaceId,
      title: body.title,
      contentType: body.content_type,
      content: body.content,
      metadata: body.metadata,
      links: links.length > 0 ? links : undefined,
    });

    return c.json(
      { canvas_artifact_id: artifact.canvas_artifact_id, created_at: artifact.created_at },
      201,
    );
  });

  /** Serve the artifact HTML with CSP headers. */
  app.get("/canvas/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const id = c.req.param("id");
    const artifact = await deps.canvasDal.getById({
      tenantId,
      canvasArtifactId: id,
    });

    if (!artifact) {
      return c.json({ error: "not_found", message: `artifact ${id} not found` }, 404);
    }

    c.header("Content-Security-Policy", CSP_HEADER);
    c.header("Content-Type", `${artifact.content_type}; charset=utf-8`);
    return c.body(artifact.content);
  });

  /** Metadata-only endpoint. */
  app.get("/canvas/:id/meta", async (c) => {
    const tenantId = requireTenantId(c);
    const id = c.req.param("id");
    const artifact = await deps.canvasDal.getById({
      tenantId,
      canvasArtifactId: id,
    });

    if (!artifact) {
      return c.json({ error: "not_found", message: `artifact ${id} not found` }, 404);
    }

    return c.json({
      canvas_artifact_id: artifact.canvas_artifact_id,
      workspace_id: artifact.workspace_id,
      title: artifact.title,
      content_type: artifact.content_type,
      metadata: artifact.metadata,
      created_at: artifact.created_at,
    });
  });

  return app;
}
