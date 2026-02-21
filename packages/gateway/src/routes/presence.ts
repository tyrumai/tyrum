/**
 * Presence endpoint — lists currently connected clients and nodes.
 */

import { Hono } from "hono";
import type { PresenceDal } from "../modules/presence/dal.js";

export function createPresenceRoutes(presenceDal: PresenceDal): Hono {
  const app = new Hono();

  app.get("/presence", async (c) => {
    const entries = await presenceDal.listActive();
    return c.json({ entries, count: entries.length });
  });

  return app;
}
