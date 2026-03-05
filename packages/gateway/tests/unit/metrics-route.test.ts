import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import {
  MetricsRegistry,
  createMetricsMiddleware,
} from "../../src/modules/observability/metrics.js";
import { createMetricsRoutes } from "../../src/routes/metrics.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Metrics routes", () => {
  let db: SqliteDb;
  let authTokens: AuthTokenService;
  let adminToken: string;
  let operatorReadToken: string;

  beforeEach(async () => {
    db = openTestSqliteDb();
    authTokens = new AuthTokenService(db);
    adminToken = (
      await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      })
    ).token;

    operatorReadToken = (
      await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        deviceId: "dev_client_1",
        scopes: ["operator.read"],
        ttlSeconds: 15 * 60,
      })
    ).token;
  });

  afterEach(async () => {
    await db.close();
  });

  function buildApp(): Hono {
    const app = new Hono();
    const registry = new MetricsRegistry();
    app.use("*", createMetricsMiddleware(registry));
    app.use("*", createAuthMiddleware(authTokens));
    app.use("*", createHttpScopeAuthorizationMiddleware());
    app.route("/", createMetricsRoutes({ registry }));
    return app;
  }

  it("requires auth", async () => {
    const app = buildApp();

    const res = await app.request("/metrics", {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("returns Prometheus text format with expected metric names", async () => {
    const app = buildApp();

    const res = await app.request("/metrics", {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/i);

    const body = await res.text();
    expect(body).toContain("http_requests_total");
    expect(body).toContain("http_request_duration_seconds");
    expect(body).toContain("ws_connections_active");
  });

  it("bounds the path label cardinality for auth failures", async () => {
    const app = buildApp();
    const uniquePath = `/__no_route_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const notFound = await app.request(uniquePath, {
      method: "GET",
    });

    expect(notFound.status).toBe(401);

    const res = await app.request("/metrics", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).not.toContain(uniquePath);
    expect(body).toContain('path="/*"');
  });
});
