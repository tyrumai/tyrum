import { Hono } from "hono";
import { ArtifactId } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { ArtifactStore } from "../modules/artifact/store.js";
import { ArtifactDal } from "../modules/artifact/dal.js";
import type { Logger } from "../modules/observability/logger.js";

export function createArtifactRoutes(deps: {
  db: SqlDb;
  artifactStore: ArtifactStore;
  logger?: Logger;
}): Hono {
  const app = new Hono();
  const artifactDal = new ArtifactDal(deps.db);

  app.get("/artifact/:artifactId", async (c) => {
    const parsed = ArtifactId.safeParse(c.req.param("artifactId"));
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", message: "artifactId must be a UUID" },
        400,
      );
    }

    const artifactId = parsed.data;
    const stored = await deps.artifactStore.get(artifactId);
    if (!stored) {
      return c.json({ error: "not_found", message: "artifact not found" }, 404);
    }

    const nowIso = new Date().toISOString();
    await artifactDal.recordFetched(artifactId, nowIso).catch(() => {
      // best-effort audit counter
    });
    deps.logger?.info("artifact.fetched", {
      artifact_id: artifactId,
      kind: stored.ref.kind,
      size_bytes: stored.ref.size_bytes,
    });

    const headers = new Headers();
    headers.set("content-type", stored.ref.mime_type ?? "application/octet-stream");
    headers.set("cache-control", "private, max-age=0, no-store");
    const buf = stored.body.buffer;
    const body =
      buf instanceof ArrayBuffer
        ? buf.slice(
            stored.body.byteOffset,
            stored.body.byteOffset + stored.body.byteLength,
          )
        : Uint8Array.from(stored.body).buffer;
    return new Response(body, { status: 200, headers });
  });

  app.get("/artifact/:artifactId/meta", async (c) => {
    const parsed = ArtifactId.safeParse(c.req.param("artifactId"));
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", message: "artifactId must be a UUID" },
        400,
      );
    }

    const row = await artifactDal.getById(parsed.data);
    if (!row) {
      return c.json({ error: "not_found", message: "artifact metadata not found" }, 404);
    }

    return c.json({ artifact: row });
  });

  return app;
}
