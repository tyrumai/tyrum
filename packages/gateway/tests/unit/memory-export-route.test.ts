import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createAuthMiddleware } from "../../src/modules/auth/middleware.js";
import { createHttpScopeAuthorizationMiddleware } from "../../src/modules/authz/http-scope-middleware.js";
import { FsArtifactStore } from "../../src/modules/artifact/store.js";
import { createMemoryExportRoutes } from "../../src/routes/memory-export.js";

describe("Memory export routes", () => {
  let tempDir: string;
  let artifactsDir: string;
  let tokenStore: TokenStore;
  let operatorReadToken: string;
  let pairingOnlyToken: string;
  let artifactStore: FsArtifactStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-memory-export-route-test-"));
    artifactsDir = await mkdtemp(join(tmpdir(), "tyrum-memory-export-artifacts-test-"));
    tokenStore = new TokenStore(tempDir);
    await tokenStore.initialize();

    operatorReadToken = (
      await tokenStore.issueDeviceToken({
        deviceId: "dev_client_1",
        role: "client",
        scopes: ["operator.read"],
        ttlSeconds: 15 * 60,
      })
    ).token;

    pairingOnlyToken = (
      await tokenStore.issueDeviceToken({
        deviceId: "dev_client_2",
        role: "client",
        scopes: ["operator.pairing"],
        ttlSeconds: 15 * 60,
      })
    ).token;

    artifactStore = new FsArtifactStore(artifactsDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use("*", createAuthMiddleware(tokenStore));
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
