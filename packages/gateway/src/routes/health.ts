/**
 * Health check route.
 */

import { Hono } from "hono";

const health = new Hono();

health.get("/healthz", (c) => {
  return c.json({ status: "ok" });
});

export { health };
