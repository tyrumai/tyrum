import { describe, expect, it, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createObservabilityRoutes, type ObservabilityDeps } from "../../src/routes/observability.js";

describe("observability routes", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = undefined;
    }
  });

  function setup(): { deps: ObservabilityDeps } {
    db = openTestSqliteDb();
    return {
      deps: {
        db,
        memoryDal: {} as any,
        version: "0.1.0-test",
        startedAt: Date.now() - 1000,
        role: "all",
      },
    };
  }

  it("GET /status returns gateway info", async () => {
    const { deps } = setup();
    const app = createObservabilityRoutes(deps);

    const res = await app.request("/status");
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.version).toBe("0.1.0-test");
    expect(body.role).toBe("all");
    expect(body.db_type).toBe("sqlite");
    expect(typeof body.uptime_ms).toBe("number");
    expect(body.connected_clients).toBe(0);
  });

  it("GET /usage returns execution statistics", async () => {
    const { deps } = setup();
    const app = createObservabilityRoutes(deps);

    const res = await app.request("/usage");
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("runs");
    expect(body).toHaveProperty("steps");
    expect(body).toHaveProperty("attempts");
  });

  it("GET /context returns memory/session counts", async () => {
    const { deps } = setup();
    const app = createObservabilityRoutes(deps);

    const res = await app.request("/context");
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("memory");
    expect(body).toHaveProperty("sessions");
  });

  it("does not leak secrets in /status", async () => {
    const { deps } = setup();
    const app = createObservabilityRoutes(deps);

    const res = await app.request("/status");
    const text = await res.text();

    expect(text).not.toContain(process.env["GATEWAY_TOKEN"] ?? "TOKEN_NOT_SET_IN_TEST");
  });
});
