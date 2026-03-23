/**
 * Prometheus metrics route.
 *
 * Protected by the gateway auth middleware when enabled.
 */

import { Hono } from "hono";
import type { MetricsRegistry } from "../app/modules/observability/metrics.js";

export function createMetricsRoutes(deps: { registry: MetricsRegistry }): Hono {
  const app = new Hono();

  app.get("/metrics", async (c) => {
    const body = await deps.registry.registry.metrics();
    return c.text(body, 200, {
      "content-type": deps.registry.registry.contentType,
    });
  });

  return app;
}
