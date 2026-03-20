import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ALLOWED_MATCH_PATHS = new Set([
  "docs/architecture/reference/arch-19-dedicated-node-backed-tools.md",
]);
const LEGACY_GENERIC_NODE_TOOL_IDS = [
  ["tool", "node", "dispatch"].join("."),
  ["tool", "node", "inspect"].join("."),
];

describe("legacy generic node tool cleanup", () => {
  it("keeps removed generic node helper ids confined to migration notes", async () => {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "-l",
        "-F",
        ...LEGACY_GENERIC_NODE_TOOL_IDS.flatMap((toolId) => ["-e", toolId]),
        "docs",
        "packages",
        "apps",
        "--glob",
        "!**/dist/**",
      ],
      { cwd: REPO_ROOT },
    );
    const matches = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(matches.toSorted()).toEqual([...ALLOWED_MATCH_PATHS]);
  }, 20_000);
});
