import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { createMemoryExportRoutes } from "../../src/routes/memory-export.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Memory export routes", () => {
  let db: SqliteDb;
  let artifactsDir: string;
  let authTokens: AuthTokenService;
  let operatorReadToken: string;
  let pairingOnlyToken: string;
  let artifactStore: FsArtifactStore;

  beforeEach(async () => {
    db = openTestSqliteDb();
    artifactsDir = await mkdtemp(join(tmpdir(), "tyrum-memory-export-artifacts-test-"));
    authTokens = new AuthTokenService(db);

    operatorReadToken = (
      await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        deviceId: "dev_client_1",
        scopes: ["operator.read"],
        ttlSeconds: 15 * 60,
      })
    ).token;

    pairingOnlyToken = (
      await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "client",
        deviceId: "dev_client_2",
        scopes: ["operator.pairing"],
        ttlSeconds: 15 * 60,
      })
    ).token;

    artifactStore = new FsArtifactStore(artifactsDir);
  });

  afterEach(async () => {
    await db.close();
    await rm(artifactsDir, { recursive: true, force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use("*", createAuthMiddleware(authTokens));
    app.use("*", createHttpScopeAuthorizationMiddleware());
    app.route("/", createMemoryExportRoutes({ artifactStore }));
    return app;
  }

  it("downloads memory export artifacts", async () => {
    const app = buildApp();

    const ref = await artifactStore.put({
      kind: "file",
      mime_type: "application/json",
      labels: ["memory", "memory_v1", "export"],
      body: Buffer.from(JSON.stringify({ v: 1, hello: "world" }), "utf8"),
    });

    const res = await app.request(`/memory/exports/${ref.artifact_id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toContain('"hello":"world"');
  });

  it("returns 404 for artifacts that are not memory exports", async () => {
    const app = buildApp();

    const ref = await artifactStore.put({
      kind: "file",
      mime_type: "text/plain",
      labels: ["run", "artifact"],
      body: Buffer.from("nope", "utf8"),
    });

    const res = await app.request(`/memory/exports/${ref.artifact_id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("returns 404 when the export artifact does not exist", async () => {
    const app = buildApp();

    const res = await app.request("/memory/exports/00000000-0000-0000-0000-000000000000", {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("defaults content-type when mime_type is missing", async () => {
    const app = buildApp();

    const ref = await artifactStore.put({
      kind: "file",
      labels: ["memory", "memory_v1", "export"],
      body: Buffer.from(JSON.stringify({ v: 1, hello: "world" }), "utf8"),
    });

    const res = await app.request(`/memory/exports/${ref.artifact_id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("returns 400 for invalid artifact ids", async () => {
    const app = buildApp();

    const res = await app.request("/memory/exports/not-a-uuid", {
      method: "GET",
      headers: { Authorization: `Bearer ${operatorReadToken}` },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("forbids scoped tokens without operator.read", async () => {
    const app = buildApp();

    const res = await app.request("/memory/exports/00000000-0000-0000-0000-000000000000", {
      method: "GET",
      headers: { Authorization: `Bearer ${pairingOnlyToken}` },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "forbidden" });
  });
});
