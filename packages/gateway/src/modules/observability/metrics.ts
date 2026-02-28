import type { Context, Next } from "hono";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { resolveHonoRoutePath } from "../../hono-route.js";

type HttpRequestTotalLabels = "method" | "path" | "status";
type HttpRequestDurationLabels = "method" | "path";

export class MetricsRegistry {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<HttpRequestTotalLabels>;
  readonly httpRequestDurationSeconds: Histogram<HttpRequestDurationLabels>;
  readonly wsConnectionsActive: Gauge<never>;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter<HttpRequestTotalLabels>({
      name: "http_requests_total",
      help: "Total number of HTTP requests processed by the gateway.",
      labelNames: ["method", "path", "status"] as const,
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram<HttpRequestDurationLabels>({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds.",
      labelNames: ["method", "path"] as const,
      registers: [this.registry],
    });

    this.wsConnectionsActive = new Gauge<never>({
      name: "ws_connections_active",
      help: "Number of active WebSocket connections.",
      registers: [this.registry],
    });
  }
}

export const gatewayMetrics = new MetricsRegistry();

export function createMetricsMiddleware(
  registry: MetricsRegistry,
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    const startedNs = process.hrtime.bigint();

    try {
      return await next();
    } finally {
      const routePath = resolveHonoRoutePath(c);
      const durationSeconds = Number(process.hrtime.bigint() - startedNs) / 1e9;

      try {
        registry.httpRequestsTotal.inc({
          method: c.req.method,
          path: routePath,
          status: String(c.res.status),
        });
        registry.httpRequestDurationSeconds.observe(
          { method: c.req.method, path: routePath },
          Math.max(0, durationSeconds),
        );
      } catch (error) {
        // Metrics must not break request handling.
        void error;
      }
    }
  };
}
