/**
 * Watcher CRUD routes.
 */

import { Hono } from "hono";
import type { WatcherProcessor } from "../modules/watcher/processor.js";

export function createWatcherRoutes(processor: WatcherProcessor): Hono {
  const watcher = new Hono();

  watcher.post("/watchers", async (c) => {
    const body = (await c.req.json()) as {
      plan_id?: string;
      trigger_type?: string;
      trigger_config?: unknown;
    };

    if (!body.plan_id || !body.trigger_type) {
      return c.json(
        {
          error: "invalid_request",
          message: "plan_id and trigger_type are required",
        },
        400,
      );
    }

    const id = processor.createWatcher(
      body.plan_id,
      body.trigger_type,
      body.trigger_config ?? {},
    );

    return c.json({ id, plan_id: body.plan_id, trigger_type: body.trigger_type }, 201);
  });

  watcher.get("/watchers", (c) => {
    const watchers = processor.listWatchers();
    return c.json({ watchers });
  });

  watcher.patch("/watchers/:id", async (c) => {
    const watcherId = parseInt(c.req.param("id"), 10);
    if (isNaN(watcherId)) {
      return c.json(
        { error: "invalid_request", message: "invalid watcher id" },
        400,
      );
    }

    const body = (await c.req.json()) as { active?: boolean };
    if (body.active === false) {
      processor.deactivateWatcher(watcherId);
    }

    return c.json({ id: watcherId, updated: true });
  });

  watcher.delete("/watchers/:id", (c) => {
    const watcherId = parseInt(c.req.param("id"), 10);
    if (isNaN(watcherId)) {
      return c.json(
        { error: "invalid_request", message: "invalid watcher id" },
        400,
      );
    }

    processor.deactivateWatcher(watcherId);
    return c.json({ id: watcherId, deleted: true });
  });

  return watcher;
}
