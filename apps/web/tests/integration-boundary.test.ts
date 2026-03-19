import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(process.cwd(), "apps/web");
const APP_SRC = join(APP_ROOT, "src");
const BANNED_PACKAGES = ["@tyrum/client", "@tyrum/contracts", "@tyrum/transport-sdk"] as const;
const BANNED_SOURCE_PATHS = [
  "packages/operator-app/src/",
  "packages/operator-ui/src/",
  "packages/contracts/src/",
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

function collectBannedImports(filePath: string): string[] {
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

    for (const bannedSourcePath of BANNED_SOURCE_PATHS) {
      if (specifier.includes(bannedSourcePath)) {
        imports.add(specifier);
      }
    }
  }
  return [...imports];
}

describe("@tyrum/web integration boundary", () => {
  it("uses public operator-app/operator-ui entrypoints from apps/web/src", () => {
    const failures = collectSourceFiles(APP_SRC)
      .map((filePath) => ({
        filePath,
        imports: collectBannedImports(filePath),
      }))
      .filter((entry) => entry.imports.length > 0)
      .map((entry) => ({
        filePath: relative(process.cwd(), entry.filePath),
        imports: entry.imports,
      }));

    expect(failures).toEqual([]);
  });

  it("does not declare deprecated transport or contract package dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
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
});
