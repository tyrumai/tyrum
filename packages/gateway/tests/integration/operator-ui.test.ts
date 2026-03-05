import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import type { GatewayContainer } from "../../src/container.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const operatorUiDistDir = join(repoRoot, "apps", "web", "dist");
const operatorUiDistAssetsDir = join(operatorUiDistDir, "assets");

const OPERATOR_UI_CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'";

describe("operator UI static hosting (/ui)", () => {
  let app: Hono;
  let container: GatewayContainer;
  let requestUnauthenticated: typeof app.request;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    container = created.container;
    requestUnauthenticated = created.requestUnauthenticated;
  });

  afterEach(async () => {
    await container.db.close();
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
    expect(html).toContain("<title>Tyrum Operator</title>");
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
    expect(html).toContain('<div id="root"></div>');
  });

  it("serves static assets with correct content-type and long cache headers", async () => {
    const indexRes = await app.request("/ui");
    expect(indexRes.status).toBe(200);
    const indexHtml = await indexRes.text();
    const match = indexHtml.match(/src="(\/ui\/assets\/[^"?]+\.js)"/);
    if (!match) {
      throw new Error("expected operator UI index.html to reference a JS asset under /ui/assets/");
    }

    const res = await app.request(match[1]!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await res.text()).trim()).not.toBe("");
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

    const filename = `unreadable-${process.pid}-${Date.now()}.js`;
    const assetPath = join(operatorUiDistAssetsDir, filename);

    try {
      await writeFile(assetPath, "console.log('unreadable')\n");
      await chmod(assetPath, 0o000);

      const res = await requestUnauthenticated(`/ui/assets/${filename}`);
      expect(res.status).toBe(500);
      expect(res.headers.get("content-security-policy")).toBe(OPERATOR_UI_CSP_POLICY);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    } finally {
      await chmod(assetPath, 0o644).catch(() => {});
      await rm(assetPath, { force: true }).catch(() => {});
    }
  });

  it("falls back to index.html for client-side routed paths", async () => {
    const res = await app.request("/ui/approvals");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
  });

  it("rejects symlink-based path escapes from the operator UI asset directory", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempRoot = await mkdtemp(join(tmpdir(), "tyrum-ui-symlink-test-"));
    const leakRoot = join(tempRoot, "leak");
    const leakFile = join(leakRoot, "secret.txt");
    const symlinkName = `leak-${process.pid}-${Date.now()}`;
    const symlinkPath = join(operatorUiDistAssetsDir, symlinkName);

    try {
      await mkdir(leakRoot, { recursive: true });
      await writeFile(leakFile, "SECRET\n");

      await symlink(leakRoot, symlinkPath);

      const res = await requestUnauthenticated(`/ui/assets/${symlinkName}/secret.txt`);
      expect(res.status).toBe(404);
    } finally {
      await rm(symlinkPath, { force: true }).catch(() => {});
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("is publicly fetchable even when auth middleware is enabled", async () => {
    const created = await createTestApp({ isLocalOnly: false });
    try {
      const res = await created.requestUnauthenticated("/ui");
      expect(res.status).toBe(200);
    } finally {
      await created.container.db.close();
    }
  });
});
