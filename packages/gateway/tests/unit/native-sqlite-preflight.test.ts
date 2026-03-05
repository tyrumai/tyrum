import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

const CHECK_SCRIPT = resolve(REPO_ROOT, "scripts/check-native-sqlite.mjs");

describe("native sqlite preflight", () => {
  it("is wired into root pretest", () => {
    const packageJsonPath = resolve(REPO_ROOT, "package.json");
    const raw = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };

    const pretest = pkg.scripts?.pretest;
    expect(pretest).toBeTypeOf("string");
    expect(pretest).toMatch(/^node scripts\/check-native-sqlite\.mjs && /);
  });

  it("fails with remediation when better-sqlite3 cannot load", () => {
    expect(existsSync(CHECK_SCRIPT)).toBe(true);

    const res = spawnSync(process.execPath, [CHECK_SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TYRUM_NATIVE_SQLITE_CHECK_TARGET: "__tyrum_nonexistent__",
      },
      encoding: "utf8",
    });

    expect(res.status).not.toBe(0);
    const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    expect(output).toContain("better-sqlite3");
    expect(output).toContain("pnpm rebuild better-sqlite3");
  });

  it("passes when better-sqlite3 loads", () => {
    expect(existsSync(CHECK_SCRIPT)).toBe(true);

    const res = spawnSync(process.execPath, [CHECK_SCRIPT], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      encoding: "utf8",
    });

    expect(res.status).toBe(0);
  });
});
