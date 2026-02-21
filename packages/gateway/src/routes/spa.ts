import { Hono } from "hono";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export interface SpaRouteDeps {
  distDir: string;
}

export function createSpaRoutes(deps: SpaRouteDeps): Hono {
  const app = new Hono();
  const distDir = deps.distDir;

  // Serve static assets from /app/assets/*
  app.get("/app/assets/*", (c) => {
    const assetPath = c.req.path.replace(/^\/app\//, "");
    const filePath = join(distDir, assetPath);

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return c.notFound();
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = readFileSync(filePath);

    c.header("Content-Type", contentType);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(content as unknown as ArrayBuffer);
  });

  // SPA fallback: any /app/* path → index.html
  app.get("/app/*", (c) => {
    const indexPath = join(distDir, "index.html");
    if (!existsSync(indexPath)) {
      return c.text("SPA not built. Run: pnpm --filter @tyrum/web-ui build", 503);
    }

    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
  });

  // Redirect bare /app to /app/
  app.get("/app", (c) => c.redirect("/app/"));

  return app;
}
