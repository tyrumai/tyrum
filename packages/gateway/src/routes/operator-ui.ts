import { Hono, type MiddlewareHandler } from "hono";
import { readFile } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const OPERATOR_UI_PATH_PREFIX = "/ui";
const OPERATOR_UI_ASSETS_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";
const EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV = "TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE";

const INDEX_CACHE_CONTROL = "no-cache";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const OPERATOR_UI_CSP_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'";

const applyOperatorUiSecurityHeaders: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } finally {
    c.header("content-security-policy", OPERATOR_UI_CSP_POLICY);
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
  }
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (err) {
    void err;
    return false;
  }
}

export type OperatorUiAssetsSource =
  | "explicit"
  | "env"
  | "workspace-dev"
  | "bundled-ui"
  | "bundled-dist-ui"
  | "unavailable";

export interface ResolvedOperatorUiAssets {
  assetsDir: string | undefined;
  assetsDirReal: string | undefined;
  source: OperatorUiAssetsSource;
}

function resolveOperatorUiAssetsDirFrom(startDir: string): {
  assetsDir: string | undefined;
  source: Exclude<OperatorUiAssetsSource, "explicit" | "env">;
} {
  // Workspace dev: prefer the Vite build output when present so the operator UI
  // can be iterated on without rebuilding the gateway bundle.
  {
    let current = startDir;
    for (let i = 0; i < 12; i += 1) {
      const marker = join(current, "pnpm-workspace.yaml");
      if (isFile(marker)) {
        const workspaceIndex = join(current, "apps", "web", "dist", "index.html");
        if (isFile(workspaceIndex)) {
          return { assetsDir: join(current, "apps", "web", "dist"), source: "workspace-dev" };
        }
        break;
      }

      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  let current = startDir;
  for (let i = 0; i < 12; i += 1) {
    const bundledCandidate = join(current, "ui", "index.html");
    if (isFile(bundledCandidate)) {
      return { assetsDir: join(current, "ui"), source: "bundled-ui" };
    }

    const distCandidate = join(current, "dist", "ui", "index.html");
    if (isFile(distCandidate)) {
      return { assetsDir: join(current, "dist", "ui"), source: "bundled-dist-ui" };
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { assetsDir: undefined, source: "unavailable" };
}

function resolveAssetPath(assetsDir: string, pathTail: string): string | undefined {
  const trimmed = pathTail.replace(/^\/+/, "");
  if (!trimmed) return undefined;

  const root = resolve(assetsDir);
  const candidate = resolve(root, trimmed);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return candidate;
}

function isSpaRoute(tail: string): boolean {
  if (!tail) return true;
  if (tail === "index.html") return true;
  if (tail.startsWith("assets/")) return false;
  if (tail.endsWith("/")) return true;

  const ext = extname(tail);
  return ext.length === 0;
}

function safeRealpathSync(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (err) {
    void err;
    return undefined;
  }
}

function containsResolvedPath(rootRealPath: string, candidateRealPath: string): boolean {
  const rel = relative(rootRealPath, candidateRealPath);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}

async function serveIndexHtml(assetsDir: string | undefined): Promise<string> {
  if (!assetsDir) return "<!doctype html><title>Tyrum unavailable</title>";
  const indexPath = join(assetsDir, "index.html");
  return await readFile(indexPath, "utf-8");
}

export function resolveOperatorUiAssets(
  opts: {
    assetsDir?: string;
    env?: NodeJS.ProcessEnv;
    moduleDir?: string;
  } = {},
): ResolvedOperatorUiAssets {
  const env = opts.env ?? process.env;
  const explicitAssetsDir = opts.assetsDir?.trim();
  const configuredAssetsDir = env[OPERATOR_UI_ASSETS_DIR_ENV]?.trim();

  if (explicitAssetsDir) {
    return {
      assetsDir: explicitAssetsDir,
      assetsDirReal: safeRealpathSync(explicitAssetsDir),
      source: "explicit",
    };
  }

  if (configuredAssetsDir) {
    return {
      assetsDir: configuredAssetsDir,
      assetsDirReal: safeRealpathSync(configuredAssetsDir),
      source: "env",
    };
  }

  const resolved = resolveOperatorUiAssetsDirFrom(
    opts.moduleDir ?? dirname(fileURLToPath(import.meta.url)),
  );
  return {
    assetsDir: resolved.assetsDir,
    assetsDirReal: resolved.assetsDir ? safeRealpathSync(resolved.assetsDir) : undefined,
    source: resolved.source,
  };
}

function logEmbeddedOperatorUiResolution(resolved: ResolvedOperatorUiAssets): void {
  const bundleSource = process.env[EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV]?.trim();
  if (!bundleSource) return;

  const pathValue = resolved.assetsDirReal ?? resolved.assetsDir ?? "unavailable";
  console.log(
    `embedded-gateway operator-ui: bundle_source=${bundleSource} assets_source=${resolved.source} assets_dir=${pathValue}`,
  );
}

export function createOperatorUiRoutes(opts: { assetsDir?: string } = {}): Hono {
  const app = new Hono();
  const resolvedAssets = resolveOperatorUiAssets({ assetsDir: opts.assetsDir });
  const { assetsDir, assetsDirReal } = resolvedAssets;
  logEmbeddedOperatorUiResolution(resolvedAssets);

  app.use(OPERATOR_UI_PATH_PREFIX, applyOperatorUiSecurityHeaders);
  app.use(`${OPERATOR_UI_PATH_PREFIX}/*`, applyOperatorUiSecurityHeaders);

  app.get(OPERATOR_UI_PATH_PREFIX, async (c) => {
    const html = await serveIndexHtml(assetsDir);
    c.header("cache-control", INDEX_CACHE_CONTROL);
    return c.html(html);
  });

  app.get(`${OPERATOR_UI_PATH_PREFIX}/*`, async (c) => {
    const requestPath = c.req.path;
    const tail = requestPath.startsWith(`${OPERATOR_UI_PATH_PREFIX}/`)
      ? requestPath.slice(`${OPERATOR_UI_PATH_PREFIX}/`.length)
      : "";
    if (isSpaRoute(tail)) {
      const html = await serveIndexHtml(assetsDir);
      c.header("cache-control", INDEX_CACHE_CONTROL);
      return c.html(html);
    }

    if (!assetsDir) {
      return c.text("operator_ui_assets_unavailable", 404);
    }

    const assetPath = resolveAssetPath(assetsDir, tail);
    if (!assetPath) {
      return c.text("not_found", 404);
    }

    if (!isFile(assetPath)) {
      return c.text("not_found", 404);
    }

    if (!assetsDirReal) {
      return c.text("not_found", 404);
    }

    const resolvedAssetPath = safeRealpathSync(assetPath);
    if (!resolvedAssetPath || !containsResolvedPath(assetsDirReal, resolvedAssetPath)) {
      return c.text("not_found", 404);
    }

    const body = await readFile(resolvedAssetPath);
    c.header("content-type", contentTypeForPath(assetPath));

    const cacheControl = tail.startsWith("assets/") ? ASSET_CACHE_CONTROL : "public, max-age=3600";
    c.header("cache-control", cacheControl);

    return c.body(body);
  });

  return app;
}
