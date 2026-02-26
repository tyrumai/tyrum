import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";

describe("legacy gateway-hosted web UI routes", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (!tempDir) return;
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("does not serve the retired /app SSR UI (404)", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/app");
    expect(res.status).toBe(404);
  });

  it("does not serve /consent or legacy /api compatibility routes (404)", async () => {
    const { app } = await createTestApp();

    expect((await app.request("/consent")).status).toBe(404);
    expect((await app.request("/api/profiles")).status).toBe(404);
  });

  it("returns 404 for retired routes even when auth is enabled", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-legacy-web-routes-"));
    const tokenStore = new TokenStore(tempDir);
    const adminToken = await tokenStore.initialize();

    const { app } = await createTestApp({ tokenStore });

    const headers = { Authorization: `Bearer ${adminToken}` };
    expect((await app.request("/app", { headers })).status).toBe(404);
    expect((await app.request("/consent", { headers })).status).toBe(404);
    expect((await app.request("/api/profiles", { headers })).status).toBe(404);
  });
});
