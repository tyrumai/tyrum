/**
 * system.ts normalizeTime — unit tests for the time normalization helper.
 *
 * The normalizeTime function is private inside system.ts, so we test it
 * indirectly through the toTenantContract response mapping. But we can
 * also test the branches via a re-export approach. Since we cannot modify
 * source code, we test the behavior through the route handler responses.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createSystemRoutes } from "../../src/routes/system.js";
import type { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { SqlDb } from "../../src/statestore/types.js";

function createMockDb(rows: Record<string, unknown>[]): SqlDb {
  return {
    kind: "sqlite" as const,
    all: vi.fn().mockResolvedValue(rows),
    get: vi.fn().mockImplementation(async (sql: string) => {
      // Handle different SELECT queries
      if (sql.includes("SELECT tenant_id FROM tenants")) return undefined;
      return undefined;
    }),
    run: vi.fn().mockResolvedValue({ changes: 0 }),
    exec: vi.fn(),
  } as unknown as SqlDb;
}

function createMockAuthTokens(): AuthTokenService {
  return {
    issueToken: vi.fn(),
    revokeToken: vi.fn(),
    authenticate: vi.fn(),
  } as unknown as AuthTokenService;
}

function buildApp(db: SqlDb): Hono {
  const app = new Hono();
  // Set up auth claims middleware for system-level access
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "sys-token",
      tenant_id: null,
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route("/", createSystemRoutes({ db, authTokens: createMockAuthTokens() }));
  return app;
}

describe("GET /system/tenants normalizeTime branches", () => {
  it("normalizes SQLite timestamp format (space-separated date/time)", async () => {
    const db = createMockDb([
      {
        tenant_id: "11111111-1111-4111-8111-111111111111",
        tenant_key: "test",
        name: "Test",
        status: "active",
        created_at: "2024-01-15 10:30:00",
        updated_at: "2024-01-15 10:30:00.123",
      },
    ]);
    const app = buildApp(db);
    const res = await app.request("/system/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: Array<{ created_at: string; updated_at: string }>;
    };
    expect(body.tenants[0]!.created_at).toBe("2024-01-15T10:30:00Z");
    expect(body.tenants[0]!.updated_at).toBe("2024-01-15T10:30:00.123Z");
  });

  it("passes through ISO format timestamps", async () => {
    const db = createMockDb([
      {
        tenant_id: "22222222-2222-4222-8222-222222222222",
        tenant_key: "iso",
        name: "ISO Test",
        status: "active",
        created_at: "2024-01-15T10:30:00Z",
        updated_at: "2024-01-15T10:30:00.000Z",
      },
    ]);
    const app = buildApp(db);
    const res = await app.request("/system/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: Array<{ created_at: string; updated_at: string }>;
    };
    expect(body.tenants[0]!.created_at).toBe("2024-01-15T10:30:00Z");
    expect(body.tenants[0]!.updated_at).toBe("2024-01-15T10:30:00.000Z");
  });

  it("handles Date objects in timestamps", async () => {
    const date = new Date("2024-06-01T12:00:00Z");
    const db = createMockDb([
      {
        tenant_id: "33333333-3333-4333-8333-333333333333",
        tenant_key: "date-obj",
        name: "Date Obj",
        status: "active",
        created_at: date,
        updated_at: date,
      },
    ]);
    const app = buildApp(db);
    const res = await app.request("/system/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: Array<{ created_at: string; updated_at: string }>;
    };
    expect(body.tenants[0]!.created_at).toBe(date.toISOString());
  });

  it("handles null timestamps by falling back to current time", async () => {
    const db = createMockDb([
      {
        tenant_id: "44444444-4444-4444-8444-444444444444",
        tenant_key: "null-times",
        name: "Null Times",
        status: "active",
        created_at: null,
        updated_at: null,
      },
    ]);
    const app = buildApp(db);
    const res = await app.request("/system/tenants");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tenants: Array<{ created_at: string; updated_at: string }>;
    };
    // Should have valid ISO timestamps (fallback to new Date().toISOString())
    expect(new Date(body.tenants[0]!.created_at).getTime()).not.toBeNaN();
    expect(new Date(body.tenants[0]!.updated_at).getTime()).not.toBeNaN();
  });
});
