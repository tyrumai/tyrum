import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

function runGit(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runNode(cwd: string, args: string[]) {
  return execFileSync(process.execPath, args, { cwd, encoding: "utf8" });
}

test("diff-lines skips non-coverable changed lines when file has no coverage entry", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "tyrum-diff-lines-"));
  try {
    runGit(tmp, ["init"]);
    runGit(tmp, ["config", "user.email", "test@example.com"]);
    runGit(tmp, ["config", "user.name", "Test User"]);

    mkdirSync(path.join(tmp, "packages/foo/src"), { recursive: true });
    writeFileSync(path.join(tmp, "README.md"), "test\n", "utf8");
    runGit(tmp, ["add", "."]);
    runGit(tmp, ["commit", "-m", "base"]);
    const base = runGit(tmp, ["rev-parse", "HEAD"]);

    writeFileSync(
      path.join(tmp, "packages/foo/src/new-file.ts"),
      [
        'import { bar } from "./bar.js";',
        "export type Baz = { x: number };",
        "export const answer = () => {",
        "  return bar();",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    runGit(tmp, ["add", "."]);
    runGit(tmp, ["commit", "-m", "add file"]);

    mkdirSync(path.join(tmp, "coverage"), { recursive: true });
    writeFileSync(path.join(tmp, "coverage/coverage-final.json"), "{}", "utf8");

    const scriptPath = fileURLToPath(
      new URL("../../../../scripts/coverage/diff-lines.mjs", import.meta.url),
    );

    const out = runNode(tmp, [
      scriptPath,
      "--base",
      base,
      "--min",
      "0",
      "--coverage",
      "coverage/coverage-final.json",
    ]);

    const match = out.match(/\((\d+)\/(\d+)\)/);
    expect(match).not.toBeNull();
    const total = Number.parseInt(match?.[2] ?? "NaN", 10);
    expect(total).toBe(2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
