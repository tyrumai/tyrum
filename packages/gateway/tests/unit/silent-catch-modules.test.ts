import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { listFilesRecursive } from "../helpers/list-files-recursive.js";

const CATCH_REGEX = /\bcatch\s*\{/;
const INTENTIONAL_MARKER = "Intentional:";

function hasIntentionalMarker(lines: string[], startIndex: number): boolean {
  const window = lines.slice(startIndex, startIndex + 5).join("\n");
  return window.includes(INTENTIONAL_MARKER);
}

describe("gateway modules silent catch audit", () => {
  it("requires any bare catch blocks to be explicitly documented as intentional", async () => {
    const testsDir = path.dirname(fileURLToPath(import.meta.url));
    const gatewayRoot = path.join(testsDir, "..", "..");
    const modulesRoot = path.join(gatewayRoot, "src", "modules");

    const files = await listFilesRecursive(modulesRoot);
    const sourceFiles = files
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .filter((file) => {
        const rel = path.relative(modulesRoot, file);
        const [topDir] = rel.split(path.sep);
        return topDir !== "execution" && topDir !== "channels";
      });

    const violations: string[] = [];

    for (const file of sourceFiles) {
      const content = await readFile(file, "utf8");
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (!CATCH_REGEX.test(line)) continue;
        if (hasIntentionalMarker(lines, i)) continue;

        const rel = path.relative(gatewayRoot, file);
        violations.push(`${rel}:${String(i + 1)} ${line.trim()}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${String(violations.length)} undocumented bare catch blocks in gateway modules.\n` +
          `Each \`catch {\` must include a comment containing "${INTENTIONAL_MARKER}" within the first few lines.\n\n` +
          violations.slice(0, 100).join("\n") +
          (violations.length > 100 ? "\n..." : ""),
      );
    }
  });
});
