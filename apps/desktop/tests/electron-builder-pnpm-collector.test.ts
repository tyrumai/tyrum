import { mkdtempSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../");
const require = createRequire(import.meta.url);

type TempDirManager = {
  getTempFile(args?: { prefix?: string; suffix?: string }): Promise<string>;
};

type DependencyNode = {
  dependencies?: DependencyNode[];
  name: string;
};

type Collector = {
  getNodeModules(args: { packageName: string }): Promise<{ nodeModules: DependencyNode[] }>;
};

type CollectorModule = {
  PM: { PNPM: string };
  getCollectorByPackageManager(
    pm: string,
    rootDir: string,
    tempDirManager: TempDirManager,
  ): Collector;
};

function resolveAppBuilderLibCollectorPath(): string {
  const electronBuilderRoot = realpathSync(
    resolve(REPO_ROOT, "apps/desktop/node_modules/electron-builder"),
  );

  return realpathSync(
    join(electronBuilderRoot, "..", "app-builder-lib", "out/node-module-collector/index.js"),
  );
}

function createTempDirManager(): TempDirManager {
  const tempRoot = mkdtempSync(join(tmpdir(), "desktop-pnpm-collector-"));
  let nextId = 0;

  return {
    async getTempFile({ prefix = "tmp", suffix = "" } = {}) {
      const extension = suffix.length > 0 ? `.${suffix}` : "";
      const fileName = `${prefix}-${nextId}${extension}`;
      nextId += 1;
      return join(tempRoot, fileName);
    },
  };
}

function flattenDependencyNames(nodes: readonly DependencyNode[]): string[] {
  return nodes.flatMap((node) => {
    const nestedNames = node.dependencies ? flattenDependencyNames(node.dependencies) : [];
    return [node.name, ...nestedNames];
  });
}

describe("app-builder-lib pnpm collector", () => {
  it("keeps deduped transitive runtime deps for desktop packaging", async () => {
    const collectorModule = require(resolveAppBuilderLibCollectorPath()) as CollectorModule;
    const collector = collectorModule.getCollectorByPackageManager(
      collectorModule.PM.PNPM,
      resolve(REPO_ROOT, "apps/desktop"),
      createTempDirManager(),
    );

    const { nodeModules } = await collector.getNodeModules({ packageName: "tyrum-desktop" });
    const names = flattenDependencyNames(nodeModules);

    expect(names).toContain("mitt");
    expect(names).toContain("ms");
  }, 15_000);
});
