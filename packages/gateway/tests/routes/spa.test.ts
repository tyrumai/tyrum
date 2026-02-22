import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { createSpaRoutes } from "../../src/routes/spa.js";

function makeTmpDist(): string {
  const dir = mkdtempSync(join(tmpdir(), "tyrum-spa-test-"));
  // Create a minimal dist structure
  writeFileSync(join(dir, "index.html"), "<!DOCTYPE html><html><body>SPA</body></html>");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log('app')");
  writeFileSync(join(dir, "assets", "index-abc123.css"), "body { margin: 0; }");
  writeFileSync(join(dir, "secret.txt"), "top-secret");
  return dir;
}

describe("SPA routes", () => {
  let distDir: string;

  afterEach(() => {
    if (distDir) rmSync(distDir, { recursive: true, force: true });
  });

  it("serves index.html for /app/ (SPA fallback)", async () => {
    distDir = makeTmpDist();
    const app = new Hono();
    app.route("/", createSpaRoutes({ distDir }));

    const res = await app.request("/app/dashboard");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("SPA");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves static JS asset", async () => {
    distDir = makeTmpDist();
    const app = new Hono();
    app.route("/", createSpaRoutes({ distDir }));

    const res = await app.request("/app/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const text = await res.text();
    expect(text).toContain("console.log");
  });

  it("returns 404 for missing static asset", async () => {
    distDir = makeTmpDist();
    const app = new Hono();
    app.route("/", createSpaRoutes({ distDir }));

    const res = await app.request("/app/assets/nonexistent.js");
    expect(res.status).toBe(404);
  });

  it("does not allow path traversal out of assets directory", async () => {
    distDir = makeTmpDist();
    const app = new Hono();
    app.route("/", createSpaRoutes({ distDir }));

    const res = await app.request("/app/assets/%2e%2e%2fsecret.txt");
    expect(res.status).toBe(404);
  });

  it("does not allow encoded traversal segments", async () => {
    distDir = makeTmpDist();
    const app = new Hono();
    app.route("/", createSpaRoutes({ distDir }));

    const res1 = await app.request("/app/assets/%2e%2e%2findex.html");
    expect(res1.status).toBe(404);

    const res2 = await app.request("/app/assets/%2e%2e%5cindex.html");
    expect(res2.status).toBe(404);
  });
});
