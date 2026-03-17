import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOperatorUiAssets } from "../../src/routes/operator-ui.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("resolveOperatorUiAssets", () => {
  it("prefers an explicit assetsDir override", async () => {
    const assetsDir = await createTempDir("tyrum-ui-assets-explicit-");
    await writeFile(join(assetsDir, "index.html"), "<!doctype html>");

    const resolved = resolveOperatorUiAssets({ assetsDir, env: {} });

    expect(resolved.source).toBe("explicit");
    expect(resolved.assetsDir).toBe(assetsDir);
    expect(resolved.assetsDirReal).toBe(assetsDir);
  });

  it("prefers the environment override before filesystem discovery", async () => {
    const assetsDir = await createTempDir("tyrum-ui-assets-env-");
    await writeFile(join(assetsDir, "index.html"), "<!doctype html>");

    const resolved = resolveOperatorUiAssets({
      env: { TYRUM_OPERATOR_UI_ASSETS_DIR: assetsDir },
      moduleDir: "/does/not/matter",
    });

    expect(resolved.source).toBe("env");
    expect(resolved.assetsDir).toBe(assetsDir);
    expect(resolved.assetsDirReal).toBe(assetsDir);
  });

  it("discovers the workspace web build before bundled assets", async () => {
    const repoRoot = await createTempDir("tyrum-ui-assets-workspace-");
    const moduleDir = join(repoRoot, "packages", "gateway", "dist");
    const workspaceDistDir = join(repoRoot, "apps", "web", "dist");
    const bundledUiDir = join(repoRoot, "packages", "gateway", "dist", "ui");

    await mkdir(moduleDir, { recursive: true });
    await mkdir(workspaceDistDir, { recursive: true });
    await mkdir(bundledUiDir, { recursive: true });
    await writeFile(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    await writeFile(join(workspaceDistDir, "index.html"), "<!doctype html>");
    await writeFile(join(bundledUiDir, "index.html"), "<!doctype html>");

    const resolved = resolveOperatorUiAssets({ env: {}, moduleDir });

    expect(resolved.source).toBe("workspace-dev");
    expect(resolved.assetsDir).toBe(workspaceDistDir);
    expect(resolved.assetsDirReal).toBe(workspaceDistDir);
  });

  it("falls back to bundled ui assets when no workspace build is available", async () => {
    const stageRoot = await createTempDir("tyrum-ui-assets-bundled-");
    const moduleDir = join(stageRoot, "dist");
    const bundledUiDir = join(stageRoot, "ui");

    await mkdir(moduleDir, { recursive: true });
    await mkdir(bundledUiDir, { recursive: true });
    await writeFile(join(bundledUiDir, "index.html"), "<!doctype html>");

    const resolved = resolveOperatorUiAssets({ env: {}, moduleDir });

    expect(resolved.source).toBe("bundled-ui");
    expect(resolved.assetsDir).toBe(bundledUiDir);
    expect(resolved.assetsDirReal).toBe(bundledUiDir);
  });
});
