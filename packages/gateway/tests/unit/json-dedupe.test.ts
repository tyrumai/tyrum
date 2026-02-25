import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

describe("json parsing utilities", () => {
  it("dedupes safeJsonParse and parseJsonOrFallback across gateway src", async () => {
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const gatewayRoot = path.join(testsDir, "..", "..");
    const srcRoot = path.join(gatewayRoot, "src");

    const files = await listFilesRecursive(srcRoot);
    const sourceFiles = files.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

    let safeJsonParseOccurrences = 0;
    let parseJsonOrFallbackOccurrences = 0;

    for (const file of sourceFiles) {
      const content = await readFile(file, "utf8");
      safeJsonParseOccurrences += content.split("function safeJsonParse").length - 1;
      parseJsonOrFallbackOccurrences += content.split("function parseJsonOrFallback").length - 1;
    }

    expect(safeJsonParseOccurrences).toBe(1);
    expect(parseJsonOrFallbackOccurrences).toBe(0);
  });
});
