import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const distDir = resolve(repoRoot, "packages/client/dist");

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function builtArtifactPaths(): string[] {
  return readdirSync(distDir)
    .filter((file) => [".mjs", ".mts"].includes(extname(file)))
    .map((file) => resolve(distDir, file))
    .toSorted();
}

beforeAll(() => {
  execFileSync(pnpmCommand(), ["--filter", "@tyrum/client", "build"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
});

describe("@tyrum/client built artifacts", () => {
  it("do not reference the legacy schemas package", () => {
    const offenders = builtArtifactPaths().filter((file) =>
      readFileSync(file, "utf8").includes("@tyrum/schemas"),
    );

    expect(offenders).toEqual([]);
  });

  it("continue to reference @tyrum/contracts from generated outputs", () => {
    expect(
      builtArtifactPaths().some((file) => readFileSync(file, "utf8").includes("@tyrum/contracts")),
    ).toBe(true);
  });
});
