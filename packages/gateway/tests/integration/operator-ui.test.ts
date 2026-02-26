import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hono } from "hono";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createTestApp } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../fixtures/operator-ui");

const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";

describe("operator UI static hosting (/ui)", () => {
  const prevUiDir = process.env[OPERATOR_UI_DIR_ENV];
  let app: Hono;

  beforeEach(async () => {
    process.env[OPERATOR_UI_DIR_ENV] = FIXTURE_DIR;
    app = (await createTestApp()).app;
  });

  afterEach(() => {
    if (prevUiDir === undefined) delete process.env[OPERATOR_UI_DIR_ENV];
    else process.env[OPERATOR_UI_DIR_ENV] = prevUiDir;
  });

  it("serves the operator SPA index at /ui", async () => {
    const res = await app.request("/ui");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const html = await res.text();
    expect(html).toContain("Operator UI Fixture");
  });

  it("serves static assets with correct content-type and long cache headers", async () => {
    const res = await app.request("/ui/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const js = await res.text();
    expect(js).toContain("operator-ui fixture loaded");
  });

  it("falls back to index.html for client-side routed paths", async () => {
    const res = await app.request("/ui/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Operator UI Fixture");
  });

  it("is publicly fetchable even when auth middleware is enabled", async () => {
    const tokenHome = await mkdtemp(join(tmpdir(), "tyrum-ui-auth-test-"));
    try {
      const tokenStore = new TokenStore(tokenHome);
      await tokenStore.initialize();
      const authedApp = (await createTestApp({ tokenStore, isLocalOnly: false })).app;

      const res = await authedApp.request("/ui");
      expect(res.status).toBe(200);
    } finally {
      await rm(tokenHome, { recursive: true, force: true });
    }
  });
});
