/**
 * Snapshot export/import routes.
 *
 * GET /snapshot/export — consistent transactional dump of durable tables.
 * POST /snapshot/import — restore durable tables from a snapshot bundle (requires confirm: true).
 */

import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import { exportSnapshot, type SnapshotBundle } from "../modules/snapshot/export.js";
import { importSnapshot } from "../modules/snapshot/import.js";

export interface SnapshotDeps {
  db: SqlDb;
}

export function createSnapshotRoutes(deps: SnapshotDeps): Hono {
  const app = new Hono();

  app.get("/snapshot/export", async (c) => {
    const bundle = await exportSnapshot(deps.db);
    return c.json(bundle);
  });

  app.post("/snapshot/import", async (c) => {
    const body = await c.req.json() as { confirm?: boolean } & Record<string, unknown>;

    if (!body.confirm) {
      return c.json(
        { error: "confirmation_required", message: "Set confirm: true to proceed with import." },
        400,
      );
    }

    // Validate as SnapshotBundle
    const bundle = body as unknown as SnapshotBundle;
    if (bundle.version !== 1 || typeof bundle.tables !== "object") {
      return c.json(
        { error: "invalid_bundle", message: "Invalid snapshot bundle format." },
        400,
      );
    }

    const result = await importSnapshot(deps.db, bundle);
    return c.json({ ok: true, ...result });
  });

  return app;
}
