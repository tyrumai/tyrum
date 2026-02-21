import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { APP_PATH_PREFIX, matchesPathPrefixSegment } from "../app-path.js";

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

  const AUTH_COOKIE_NAME = "tyrum_admin_token";
  const AUTH_QUERY_PARAM = "token";

  // Auth endpoint — sets cookie and redirects, must be before SPA fallback
  app.get("/app/auth", (c) => {
    const search = new URL(c.req.url).searchParams;
    const token = search.get(AUTH_QUERY_PARAM)?.trim();
    const requestedNext = search.get("next") ?? APP_PATH_PREFIX;
    let nextPath = APP_PATH_PREFIX;
    try {
      const parsedNext = new URL(requestedNext, "http://tyrum.local");
      if (matchesPathPrefixSegment(parsedNext.pathname, APP_PATH_PREFIX)) {
        nextPath = `${parsedNext.pathname}${parsedNext.search}${parsedNext.hash}`;
      }
    } catch {
      // Ignore invalid next parameter and fall back to the app root.
    }
    if (!token) {
      return c.redirect(nextPath);
    }
    setCookie(c, AUTH_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
      maxAge: 604800,
    });
    return c.redirect(nextPath);
  });

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
