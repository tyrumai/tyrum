/**
 * Health check route.
 */

import { Hono } from "hono";

export interface HealthOptions {
  isLocalOnly: boolean;
}

export function createHealthRoute(opts: HealthOptions = { isLocalOnly: true }): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => {
    return c.json({ status: "ok", is_exposed: !opts.isLocalOnly });
  });

  return app;
}

/** @deprecated Use createHealthRoute() instead. Kept for backward compatibility with tests. */
const health = new Hono();
health.get("/healthz", (c) => {
  return c.json({ status: "ok", is_exposed: false });
});

export { health };
