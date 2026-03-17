import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const DIST_ROOT = resolve(APP_ROOT, "dist");
const DIST_INDEX = resolve(DIST_ROOT, "index.html");
const VITE_CONFIG = resolve(APP_ROOT, "vite.config.ts");
const HTML_RESOURCE_PATH = /(?:src|href)="([^"]+)"/gu;

function readBuiltIndexHtml(): string {
  if (!existsSync(DIST_INDEX)) {
    throw new Error(
      `Expected built web UI artifact at ${DIST_INDEX}. Run "pnpm test", "pnpm test:watch", or "pnpm --filter @tyrum/web build" before invoking this test directly.`,
    );
  }

  return readFileSync(DIST_INDEX, "utf8");
}

function getReferencedResourcePaths(indexHtml: string): string[] {
  return [...indexHtml.matchAll(HTML_RESOURCE_PATH)].map((match) => match[1]);
}

function readBuiltCssAsset(indexHtml: string): string {
  const cssResourcePath = getReferencedResourcePaths(indexHtml).find((resourcePath) =>
    resourcePath.endsWith(".css"),
  );

  if (!cssResourcePath?.startsWith("/ui/")) {
    throw new Error(`Expected a built CSS asset reference in ${DIST_INDEX}.`);
  }

  return readFileSync(resolve(DIST_ROOT, cssResourcePath.slice("/ui/".length)), "utf8");
}

function shouldRefreshBuildOutput(): boolean {
  return !process.argv.includes("run") && !process.argv.includes("--run");
}

async function ensureBuiltIndexHtml(): Promise<string> {
  if (!existsSync(DIST_INDEX) || shouldRefreshBuildOutput()) {
    const originalCwd = process.cwd();

    try {
      process.chdir(APP_ROOT);
      await build({
        configFile: VITE_CONFIG,
        logLevel: "error",
      });
    } finally {
      process.chdir(originalCwd);
    }
  }

  return readBuiltIndexHtml();
}

describe("apps/web", () => {
  it("uses prebuilt /ui assets for gateway hosting", { timeout: 180_000 }, async () => {
    const indexHtml = await ensureBuiltIndexHtml();
    const referencedResources = getReferencedResourcePaths(indexHtml);
    const rootRelativeResources = referencedResources.filter((resourcePath) =>
      resourcePath.startsWith("/"),
    );

    expect(indexHtml).toContain('<div id="root"></div>');
    expect(rootRelativeResources.length).toBeGreaterThan(0);

    for (const resourcePath of rootRelativeResources) {
      expect(resourcePath.startsWith("/ui/")).toBe(true);
      expect(existsSync(resolve(DIST_ROOT, resourcePath.slice("/ui/".length)))).toBe(true);
    }
  });

  it("includes Tailwind typography styles for markdown content", { timeout: 180_000 }, async () => {
    const indexHtml = await ensureBuiltIndexHtml();
    const css = readBuiltCssAsset(indexHtml);

    expect(css).toContain(".prose");
    expect(css).toContain("--tw-prose-body");
  });
});
