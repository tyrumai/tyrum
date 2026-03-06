import type { Context, Next } from "hono";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { getLeafHonoRoutePath } from "../../hono-route.js";

type HttpRequestTotalLabels = "method" | "path" | "status";
type HttpRequestDurationLabels = "method" | "path";
type LifecyclePruneRowsLabels = "scheduler" | "table";
type LifecycleTickErrorsLabels = "scheduler";
type PersistedJsonReadFailuresLabels = "table" | "column" | "reason";

export type LifecycleSchedulerName = "outbox" | "statestore";
const WS_SLOW_CONSUMER_BUFFERED_AMOUNT_BUCKETS = [
  64 * 1024,
  256 * 1024,
  512 * 1024,
  1024 * 1024,
  2 * 1024 * 1024,
  5 * 1024 * 1024,
  10 * 1024 * 1024,
];

export class MetricsRegistry {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<HttpRequestTotalLabels>;
  readonly httpRequestDurationSeconds: Histogram<HttpRequestDurationLabels>;
  readonly lifecyclePruneRowsTotal: Counter<LifecyclePruneRowsLabels>;
  readonly lifecycleTickErrorsTotal: Counter<LifecycleTickErrorsLabels>;
  readonly persistedJsonReadFailuresTotal: Counter<PersistedJsonReadFailuresLabels>;
  readonly wsConnectionsActive: Gauge<never>;
  readonly wsSlowConsumerEvictionsTotal: Counter<never>;
  readonly wsSendFailuresTotal: Counter<never>;
  readonly wsSlowConsumerBufferedAmountBytes: Histogram<never>;

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

    this.lifecyclePruneRowsTotal = new Counter<LifecyclePruneRowsLabels>({
      name: "lifecycle_prune_rows_total",
      help: "Rows pruned by background lifecycle maintenance.",
      labelNames: ["scheduler", "table"] as const,
      registers: [this.registry],
    });

    this.lifecycleTickErrorsTotal = new Counter<LifecycleTickErrorsLabels>({
      name: "lifecycle_tick_errors_total",
      help: "Background lifecycle scheduler tick failures.",
      labelNames: ["scheduler"] as const,
      registers: [this.registry],
    });

    this.persistedJsonReadFailuresTotal = new Counter<PersistedJsonReadFailuresLabels>({
      name: "persisted_json_read_failures_total",
      help: "Persisted JSON read failures by table, column, and reason.",
      labelNames: ["table", "column", "reason"] as const,
      registers: [this.registry],
    });

    this.wsConnectionsActive = new Gauge<never>({
      name: "ws_connections_active",
      help: "Number of active WebSocket connections.",
      registers: [this.registry],
    });

    this.wsSlowConsumerEvictionsTotal = new Counter<never>({
      name: "ws_slow_consumer_evictions_total",
      help: "Number of WebSocket peers evicted for exceeding the outbound buffer limit.",
      registers: [this.registry],
    });

    this.wsSendFailuresTotal = new Counter<never>({
      name: "ws_send_failures_total",
      help: "Number of WebSocket send attempts that failed.",
      registers: [this.registry],
    });

    this.wsSlowConsumerBufferedAmountBytes = new Histogram<never>({
      name: "ws_slow_consumer_buffered_amount_bytes",
      help: "Buffered outbound WebSocket bytes observed when evicting slow consumers.",
      buckets: WS_SLOW_CONSUMER_BUFFERED_AMOUNT_BUCKETS,
      registers: [this.registry],
    });
  }

  recordLifecyclePruneRows(
    scheduler: LifecycleSchedulerName,
    table: string,
    rowsPruned: number,
  ): void {
    if (!Number.isFinite(rowsPruned) || rowsPruned <= 0) return;
    try {
      this.lifecyclePruneRowsTotal.inc({ scheduler, table }, rowsPruned);
    } catch {
      // Intentional: lifecycle maintenance must continue even if Prometheus rejects a sample.
    }
  }

  recordLifecycleTickError(scheduler: LifecycleSchedulerName): void {
    try {
      this.lifecycleTickErrorsTotal.inc({ scheduler });
    } catch {
      // Intentional: error accounting must not make a failed lifecycle tick worse.
    }
  }

  recordPersistedJsonReadFailure(table: string, column: string, reason: string): void {
    try {
      this.persistedJsonReadFailuresTotal.inc({ table, column, reason });
    } catch {
      // Intentional: read-path observability must not break normal request handling.
    }
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
      const routePath = getLeafHonoRoutePath(c) ?? "/*";
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
