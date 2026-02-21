/**
 * Snapshot export/import routes.
 *
 * GET /snapshot/export — consistent transactional dump of durable tables.
 * POST /snapshot/import — reserved, requires explicit confirmation (not yet implemented).
 */

import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import { exportSnapshot } from "../modules/snapshot/export.js";

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
    return c.json(
      { error: "not_implemented", message: "Snapshot import requires explicit confirmation and is not yet available." },
      501,
    );
  });

  return app;
}
