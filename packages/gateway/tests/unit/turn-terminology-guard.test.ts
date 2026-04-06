import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listFilesRecursive } from "../helpers/list-files-recursive.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const sourceRoots = [
  resolve(repoRoot, "packages/contracts/src"),
  resolve(repoRoot, "packages/gateway/src"),
  resolve(repoRoot, "packages/node-sdk/src"),
  resolve(repoRoot, "packages/operator-ui/src"),
  resolve(repoRoot, "packages/runtime-execution/src"),
  resolve(repoRoot, "packages/runtime-node-control/src"),
  resolve(repoRoot, "packages/transport-sdk/src"),
] as const;

const allowlistedFiles = new Set<string>(["packages/operator-ui/src/local-node-auto-approval.tsx"]);

const blockedPatterns = [
  { label: "run_id", regex: /\brun_id\b/g },
  { label: "runId", regex: /\brunId\b/g },
  { label: "resume_run", regex: /\bresume_run\b/g },
  { label: "cancel_run", regex: /\bcancel_run\b/g },
] as const;

async function listTrackedSourceFiles(rootDir: string): Promise<string[]> {
  const relDir = relative(repoRoot, rootDir).replaceAll("\\", "/");

  try {
    const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "--", relDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return tracked
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".ts") || line.endsWith(".tsx"))
      .map((line) => resolve(repoRoot, line))
      .toSorted();
  } catch {
    return (await listFilesRecursive(rootDir))
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .toSorted();
  }
}

function findBlockedMatches(filePath: string, content: string): string[] {
  const relPath = relative(repoRoot, filePath).replaceAll("\\", "/");
  if (allowlistedFiles.has(relPath)) {
    return [];
  }

  const hits: string[] = [];
  for (const { label, regex } of blockedPatterns) {
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
      const matchIndex = match.index ?? 0;
      const line = content.slice(0, matchIndex).split("\n").length;
      hits.push(`${relPath}:${String(line)} contains blocked legacy token '${label}'`);
    }
  }
  return hits;
}

describe("turn terminology guard", () => {
  it("keeps turn identity free of legacy run tokens in source files", async () => {
    const files = (await Promise.all(sourceRoots.map((rootDir) => listTrackedSourceFiles(rootDir))))
      .flat()
      .filter((filePath) => existsSync(filePath))
      .toSorted();

    const hits = files.flatMap((filePath) =>
      findBlockedMatches(filePath, readFileSync(filePath, "utf8")),
    );

    expect(hits).toEqual([]);
  });
});
