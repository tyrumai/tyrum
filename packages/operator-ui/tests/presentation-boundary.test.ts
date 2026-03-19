import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const OPERATOR_UI_ROOT = join(process.cwd(), "packages/operator-ui");
const OPERATOR_UI_SRC = join(OPERATOR_UI_ROOT, "src");
const BANNED_PACKAGES = [
  "@tyrum/client",
  "@tyrum/desktop-node",
  "@tyrum/gateway",
  "@tyrum/node-sdk",
  "@tyrum/transport-sdk",
] as const;
const REMOVED_RUNTIME_FILES = [
  "src/browser-node/browser-capability-provider.ts",
  "src/browser-node/browser-node-capability-state.ts",
] as const;

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function collectDirectPackageImports(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const imports = new Set<string>();
  const pattern = /\b(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (!specifier) {
      continue;
    }
    for (const bannedPackage of BANNED_PACKAGES) {
      if (specifier === bannedPackage || specifier.startsWith(`${bannedPackage}/`)) {
        imports.add(specifier);
      }
    }
  }
  return [...imports];
}

describe("@tyrum/operator-ui presentation boundary", () => {
  it("does not import transport or runtime packages directly", () => {
    const failures = collectSourceFiles(OPERATOR_UI_SRC)
      .map((filePath) => ({
        filePath,
        imports: collectDirectPackageImports(filePath),
      }))
      .filter((entry) => entry.imports.length > 0)
      .map((entry) => ({
        filePath: relative(process.cwd(), entry.filePath),
        imports: entry.imports,
      }));

    expect(failures).toEqual([]);
  });

  it("does not declare direct transport or runtime package dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(OPERATOR_UI_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];

    expect(
      declared.filter((pkg) => BANNED_PACKAGES.includes(pkg as (typeof BANNED_PACKAGES)[number])),
    ).toEqual([]);
  });

  it("does not keep browser runtime helper modules in the presentation package", () => {
    for (const relativePath of REMOVED_RUNTIME_FILES) {
      expect(existsSync(join(OPERATOR_UI_ROOT, relativePath))).toBe(false);
    }
  });
});
