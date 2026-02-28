import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listFilesRecursive } from "../helpers/list-files-recursive.js";

describe("db-time normalization", () => {
  it("dedupes sqlite datetime('now') regex across gateway src", async () => {
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const gatewayRoot = path.join(testsDir, "..", "..");
    const srcRoot = path.join(gatewayRoot, "src");

    const files = await listFilesRecursive(srcRoot);
    const sourceFiles = files.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

    const sqliteNowRegexSnippet = "/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(";

    let occurrences = 0;
    for (const file of sourceFiles) {
      const content = await readFile(file, "utf8");
      occurrences += content.split(sqliteNowRegexSnippet).length - 1;
    }

    expect(occurrences).toBe(1);
  });
});
