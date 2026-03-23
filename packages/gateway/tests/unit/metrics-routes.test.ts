/**
 * metrics.ts — unit tests for Prometheus metrics route.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createMetricsRoutes } from "../../src/routes/metrics.js";
import type { MetricsRegistry } from "../../src/modules/observability/metrics.js";

describe("GET /metrics", () => {
  it("returns Prometheus metrics text with correct content type", async () => {
    const mockRegistry = {
      registry: {
        metrics: vi.fn().mockResolvedValue("# HELP http_requests_total\nhttp_requests_total 42\n"),
        contentType: "text/plain; version=0.0.4; charset=utf-8",
      },
    } as unknown as MetricsRegistry;

    const app = new Hono();
    app.route("/", createMetricsRoutes({ registry: mockRegistry }));

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("http_requests_total");
  });
});
