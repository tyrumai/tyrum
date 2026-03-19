import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const distDir = resolve(repoRoot, "packages/desktop-node/dist");
const distEntry = resolve(distDir, "index.mjs");

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

beforeAll(() => {
  execFileSync(pnpmCommand(), ["--filter", "@tyrum/client", "build"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  if (!existsSync(distEntry)) {
    execFileSync(pnpmCommand(), ["--filter", "@tyrum/desktop-node", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  }
});

describe("@tyrum/desktop-node package build", () => {
  it("keeps Playwright external at runtime", () => {
    const files = readdirSync(distDir);
    expect(files.some((file) => /^playwright-.*\.mjs(?:\.map)?$/.test(file))).toBe(false);

    const built = readFileSync(distEntry, "utf8");
    expect(built).toContain('await import("playwright")');
  });

  it("re-exports runtime providers declared by the package entrypoint", () => {
    const built = readFileSync(distEntry, "utf8");

    expect(built).toContain("FilesystemProvider");
    expect(built).toContain("PlaywrightProvider");
    expect(built).toContain("RealPlaywrightBackend");
    expect(built).toMatch(
      /export \{[^}]*FilesystemProvider[^}]*PlaywrightProvider[^}]*RealPlaywrightBackend[^}]*\}/,
    );
  });
});
