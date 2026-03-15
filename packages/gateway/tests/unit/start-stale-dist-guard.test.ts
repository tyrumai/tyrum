import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

describe("gateway dev-start stale dist guard", () => {
  it("runs start via the CLI wrapper (so it can rebuild dist when running from source)", async () => {
    const pkgPath = resolve(PACKAGE_ROOT, "package.json");
    const pkgRaw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.start).toBe("node bin/tyrum.mjs");
  });

  it("delegates to the shared bootstrap helper instead of statically importing dist", async () => {
    const binPath = resolve(PACKAGE_ROOT, "bin/tyrum.mjs");
    const bin = await readFile(binPath, "utf-8");

    expect(bin).not.toContain('from "../dist/index.mjs"');
    expect(bin).toContain("package-bin-bootstrap.mjs");
    expect(bin).toContain("await runPackageBin");
  });

  it("keeps the dynamic dist import in the shared bootstrap helper", async () => {
    const helperPath = resolve(REPO_ROOT, "scripts/package-bin-bootstrap.mjs");
    const helper = await readFile(helperPath, "utf-8");

    expect(helper).toContain("await import");
    expect(helper).toContain("pathToFileURL(distEntrypoint).href");
  });

  it("treats missing dependency dist entrypoints as stale in the shared bootstrap helper", async () => {
    const helperPath = resolve(REPO_ROOT, "scripts/package-bin-bootstrap.mjs");
    const helper = await readFile(helperPath, "utf-8");
    const binPath = resolve(PACKAGE_ROOT, "bin/tyrum.mjs");
    const bin = await readFile(binPath, "utf-8");

    expect(helper).toContain("dependencyEntrypoints");
    expect(helper).toContain("!existsSync(dependencyEntrypoint)");
    expect(bin).toContain('"packages/schemas/dist/index.mjs"');
  });

  it("falls back to corepack pnpm when pnpm is not directly available", async () => {
    const helperPath = resolve(REPO_ROOT, "scripts/package-bin-bootstrap.mjs");
    const helper = await readFile(helperPath, "utf-8");

    expect(helper).toContain('String(result.error.message || "").includes("ENOENT")');
    expect(helper).toContain('tryBuild(input.repoRoot, "corepack", ["pnpm", ...args])');
  });
});
