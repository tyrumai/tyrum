import { describe, expect, it, vi } from "vitest";

describe("createMetricsMiddleware", () => {
  it("does not use the raw request path as a label when matchedRoutes is unavailable", async () => {
    vi.resetModules();
    vi.doMock("hono/route", () => ({
      matchedRoutes: () => {
        throw new Error("matchedRoutes unavailable");
      },
    }));

    const [{ Hono }, { MetricsRegistry, createMetricsMiddleware }, { createMetricsRoutes }] =
      await Promise.all([
        import("hono"),
        import("../../src/modules/observability/metrics.js"),
        import("../../src/routes/metrics.js"),
      ]);

    const app = new Hono();
    const registry = new MetricsRegistry();
    app.use("*", createMetricsMiddleware(registry));
    app.route("/", createMetricsRoutes({ registry }));

    const uniquePath = `/__no_route_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const notFound = await app.request(uniquePath, { method: "GET" });
    expect(notFound.status).toBe(404);

    const res = await app.request("/metrics", { method: "GET" });
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).not.toContain(uniquePath);
    expect(body).toContain('path="/*"');
  });
});

