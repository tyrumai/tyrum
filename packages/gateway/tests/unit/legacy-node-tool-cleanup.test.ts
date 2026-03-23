import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
    const trackedFiles = execFileSync("git", ["ls-files", "--", "docs", "packages", "apps"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const filesToScan = trackedFiles
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          line.startsWith("docs/") || line.startsWith("packages/") || line.startsWith("apps/"),
      )
      .filter((line) => !line.includes("/dist/"));

    const matches: string[] = [];
    for (const relativePath of filesToScan) {
      const filePath = resolve(REPO_ROOT, relativePath);
      let content: string;

      try {
        content = await readFile(filePath, "utf8");
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      if (LEGACY_GENERIC_NODE_TOOL_IDS.some((toolId) => content.includes(toolId))) {
        matches.push(relativePath);
      }
    }

    expect(matches.toSorted()).toEqual([...ALLOWED_MATCH_PATHS]);
  }, 20_000);
});
