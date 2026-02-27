/**
 * Memory export artifact routes — download bytes for ArtifactStore-backed memory exports.
 *
 * These artifacts are intentionally not exposed via the generic `/artifacts/:id` route since
 * that API must be scope-bound to a durable execution scope (run/step/attempt). Memory exports
 * are operator-surface artifacts and are instead scope-bound to `/memory/*` (operator.read).
 */

import { Hono } from "hono";
import { ArtifactId } from "@tyrum/schemas";
import type { ArtifactStore } from "../modules/artifact/store.js";

const ARTIFACT_NOT_FOUND_BODY = { error: "not_found", message: "artifact not found" } as const;

function isMemoryExportLabels(labels: readonly string[] | undefined): boolean {
  if (!Array.isArray(labels)) return false;
  const set = new Set(labels);
  return set.has("memory") && set.has("memory_v1") && set.has("export");
}

export function createMemoryExportRoutes(deps: { artifactStore: ArtifactStore }): Hono {
  const app = new Hono();

  app.get("/memory/exports/:id", async (c) => {
    const artifactId = c.req.param("id");
    const parsedId = ArtifactId.safeParse(artifactId);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "invalid artifact id" }, 400);
    }

    const stored = await deps.artifactStore.get(parsedId.data);
    if (!stored) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    if (!isMemoryExportLabels(stored.ref.labels)) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    c.header("Cache-Control", "no-store");
    c.header("Content-Type", stored.ref.mime_type ?? "application/octet-stream");
    c.header("Content-Length", String(stored.body.byteLength));
    c.header(
      "Content-Disposition",
      `attachment; filename="tyrum-memory-export-${parsedId.data}.json"`,
    );

    const bytes = new Uint8Array(
      stored.body.buffer as ArrayBuffer,
      stored.body.byteOffset,
      stored.body.byteLength,
    );
    return c.body(bytes);
  });

  return app;
}
