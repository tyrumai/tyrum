/**
 * Artifact metadata + fetch routes.
 */

import { Hono } from "hono";
import type { ArtifactMetadataDal } from "../modules/artifact/metadata-dal.js";
import type { ArtifactStore } from "../modules/artifact/store.js";
import type { EventPublisher } from "../modules/backplane/event-publisher.js";

export interface ArtifactRouteDeps {
  artifactMetadataDal: ArtifactMetadataDal;
  artifactStore: ArtifactStore;
  eventPublisher?: EventPublisher;
}

export function createArtifactRoutes(deps: ArtifactRouteDeps): Hono {
  const app = new Hono();

  // TODO(ARI-83a27ca2): For S3 deployments, generate presigned URLs instead of proxying.
  app.get("/artifacts/:id", async (c) => {
    const artifactId = c.req.param("id");
    const meta = await deps.artifactMetadataDal.getById(artifactId);
    if (!meta) {
      return c.json({ error: "not_found", message: "artifact not found" }, 404);
    }

    // Agent-id scoping: deny cross-agent access when header is present
    const requestAgentId = c.req.header("X-Tyrum-Agent-Id");
    const metaAgentId = (meta as unknown as Record<string, unknown>)["agent_id"];
    if (requestAgentId && metaAgentId && requestAgentId !== metaAgentId) {
      return c.json({ error: "forbidden", message: "agent_id mismatch" }, 403);
    }

    // Emit audit event for artifact fetch
    void deps.eventPublisher?.publish("artifact.fetched", {
      artifact_id: artifactId,
      run_id: meta.run_id,
    }).catch(() => { /* best-effort */ });

    const wantBlob = c.req.query("content") === "true";
    if (!wantBlob) {
      return c.json({ artifact: meta });
    }

    // Stream the artifact content
    try {
      const result = await deps.artifactStore.get(artifactId);
      if (!result) {
        return c.json({ error: "blob_not_found", message: "artifact content not available" }, 404);
      }
      c.header("Content-Type", meta.mime_type ?? "application/octet-stream");
      c.header("Content-Length", String(result.body.byteLength));
      c.status(200);
      return c.body(result.body as unknown as ArrayBuffer);
    } catch {
      return c.json({ error: "blob_not_found", message: "artifact content not available" }, 404);
    }
  });

  app.get("/artifacts", async (c) => {
    const runId = c.req.query("run_id");
    const stepId = c.req.query("step_id");

    if (runId) {
      const artifacts = await deps.artifactMetadataDal.listByRun(runId);
      return c.json({ artifacts });
    }

    if (stepId) {
      const artifacts = await deps.artifactMetadataDal.listByStep(stepId);
      return c.json({ artifacts });
    }

    return c.json({ error: "invalid_request", message: "run_id or step_id query parameter required" }, 400);
  });

  return app;
}
