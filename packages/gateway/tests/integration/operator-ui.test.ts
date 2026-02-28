import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { Hono } from "hono";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createTestApp } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../fixtures/operator-ui");

const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";
const OPERATOR_UI_CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'";

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
    expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const html = await res.text();
    expect(html).toContain("Operator UI Fixture");
  });

  it("sets security headers on the SPA entry response (/ui/)", async () => {
    const res = await app.request("/ui/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves /ui/index.html with conservative cache headers", async () => {
    const res = await app.request("/ui/index.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const html = await res.text();
    expect(html).toContain("Operator UI Fixture");
  });

  it("serves static assets with correct content-type and long cache headers", async () => {
    const res = await app.request("/ui/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const js = await res.text();
    expect(js).toContain("operator-ui fixture loaded");
  });

  it("returns 404 for missing /ui/assets files instead of serving index.html", async () => {
    const res = await app.request("/ui/assets/app");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sets security headers on internal errors under /ui/*", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "tyrum-ui-error-test-"));
    const assetsDir = join(tempRoot, "ui");
    const assetPath = join(assetsDir, "assets", "unreadable.js");

    try {
      await mkdir(join(assetsDir, "assets"), { recursive: true });
      await writeFile(join(assetsDir, "index.html"), "<!doctype html><div>error test</div>\n");
      await writeFile(assetPath, "console.log('unreadable')\n");
      await chmod(assetPath, 0o000);

      process.env[OPERATOR_UI_DIR_ENV] = assetsDir;
      const errApp = (await createTestApp()).app;

      const res = await errApp.request("/ui/assets/unreadable.js");
      expect(res.status).toBe(500);
      expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    } finally {
      await chmod(assetPath, 0o644).catch(() => {});
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to index.html for client-side routed paths", async () => {
    const res = await app.request("/ui/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Operator UI Fixture");
  });

  it("rejects symlink-based path escapes from the operator UI asset directory", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "tyrum-ui-symlink-test-"));
    const assetsDir = join(tempRoot, "ui");
    const leakRoot = join(tempRoot, "leak");
    const leakFile = join(leakRoot, "secret.txt");

    try {
      await mkdir(join(assetsDir, "assets"), { recursive: true });
      await mkdir(leakRoot, { recursive: true });
      await writeFile(join(assetsDir, "index.html"), "<!doctype html><div>symlink test</div>\n");
      await writeFile(leakFile, "SECRET\n");

      await symlink(leakRoot, join(assetsDir, "assets", "leak"));

      process.env[OPERATOR_UI_DIR_ENV] = assetsDir;
      const symlinkedApp = (await createTestApp()).app;

      const res = await symlinkedApp.request("/ui/assets/leak/secret.txt");
      expect(res.status).toBe(404);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
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
