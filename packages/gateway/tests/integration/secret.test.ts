import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSecretRoutes } from "../../src/routes/secret.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Secret routes (integration)", () => {
  let tempDir: string;
  let dbPath: string;
  let tyrumHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-route-test-"));
    dbPath = join(tempDir, "gateway.db");
    tyrumHome = join(tempDir, "home");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function setup() {
    const db = openTestSqliteDb(dbPath);
    const provider = await createDbSecretProvider({
      db,
      dbPath,
      tyrumHome,
      tenantId: DEFAULT_TENANT_ID,
    });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "test-token",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      await next();
    });
    app.route(
      "/",
      createSecretRoutes({
        secretProviderForTenant: () => provider,
      }),
    );
    return { app, provider, db };
  }

  it("POST /secrets stores a secret and returns a handle", async () => {
    const { app, db } = await setup();
    try {
      const res = await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "db_password", value: "super-secret-123" }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        handle: { handle_id: string; provider: string; scope: string };
      };
      expect(body.handle.handle_id).toBe("db_password");
      expect(body.handle.provider).toBe("db");
      expect(body.handle.scope).toBe("db_password");
      expect(JSON.stringify(body)).not.toContain("super-secret-123");
    } finally {
      await db.close();
    }
  });

  it("POST /secrets returns 409 on duplicate secret_key", async () => {
    const { app, db } = await setup();
    try {
      const first = await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "dup", value: "v1" }),
      });
      expect(first.status).toBe(201);

      const second = await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "dup", value: "v2" }),
      });
      expect(second.status).toBe(409);
    } finally {
      await db.close();
    }
  });

  it("POST /secrets returns 409 for one of two concurrent creates and does not clobber", async () => {
    const firstSetup = await setup();
    const secondSetup = await setup();
    try {
      await firstSetup.db.exec("PRAGMA busy_timeout = 25");
      await secondSetup.db.exec("PRAGMA busy_timeout = 25");

      const [first, second] = await Promise.all([
        firstSetup.app.request("/secrets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret_key: "dup_atomic", value: "v1" }),
        }),
        secondSetup.app.request("/secrets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret_key: "dup_atomic", value: "v2" }),
        }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const winnerValue = first.status === 201 ? "v1" : "v2";
      const resolved = await firstSetup.provider.resolve({
        handle_id: "dup_atomic",
        provider: "db",
        scope: "dup_atomic",
        created_at: new Date().toISOString(),
      });
      expect(resolved).toBe(winnerValue);

      const handles = await firstSetup.provider.list();
      expect(handles.filter((h) => h.handle_id === "dup_atomic")).toHaveLength(1);
    } finally {
      await Promise.all([firstSetup.db.close(), secondSetup.db.close()]);
    }
  });

  it("GET /secrets lists stored handles", async () => {
    const { app, db } = await setup();
    try {
      await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "key_a", value: "val-a" }),
      });
      await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "key_b", value: "val-b" }),
      });

      const res = await app.request("/secrets");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { handles: Array<{ handle_id: string }> };
      expect(body.handles.map((h) => h.handle_id).sort()).toEqual(["key_a", "key_b"]);
      expect(JSON.stringify(body)).not.toContain("val-a");
      expect(JSON.stringify(body)).not.toContain("val-b");
    } finally {
      await db.close();
    }
  });

  it("DELETE /secrets/:id revokes a handle", async () => {
    const { app, db } = await setup();
    try {
      const storeRes = await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "temp", value: "temp-val" }),
      });
      const { handle } = (await storeRes.json()) as { handle: { handle_id: string } };

      const deleteRes = await app.request(`/secrets/${handle.handle_id}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      const deleteBody = (await deleteRes.json()) as { revoked: boolean };
      expect(deleteBody.revoked).toBe(true);

      const listRes = await app.request("/secrets");
      const listBody = (await listRes.json()) as { handles: unknown[] };
      expect(listBody.handles).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it("POST /secrets/:id/rotate publishes a new version under the same handle", async () => {
    const { app, provider, db } = await setup();
    try {
      await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "rotate_me", value: "v1" }),
      });

      const rotateRes = await app.request(`/secrets/rotate_me/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "v2" }),
      });
      expect(rotateRes.status).toBe(201);
      const rotateBody = (await rotateRes.json()) as {
        revoked: boolean;
        handle: { handle_id: string };
      };
      expect(rotateBody.handle.handle_id).toBe("rotate_me");

      const resolved = await provider.resolve({
        handle_id: "rotate_me",
        provider: "db",
        scope: "rotate_me",
        created_at: new Date().toISOString(),
      });
      expect(resolved).toBe("v2");
    } finally {
      await db.close();
    }
  });

  it("POST /secrets rejects invalid body", async () => {
    const { app, db } = await setup();
    try {
      const res = await app.request("/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_key: "", value: "" }),
      });
      expect(res.status).toBe(400);
    } finally {
      await db.close();
    }
  });
});
