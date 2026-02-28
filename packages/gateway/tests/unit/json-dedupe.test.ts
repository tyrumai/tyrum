import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFilesRecursive } from "../helpers/list-files-recursive.js";

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
