import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Issue #840 docs", () => {
  it("does not use implementation-status framing in architecture docs", async () => {
    const docsDir = resolve(repoRoot, "docs/architecture");
    const markdownFiles = await listMarkdownFiles(docsDir);
    expect(markdownFiles.length).toBeGreaterThan(0);

    for (const filePath of markdownFiles) {
      const content = await readFile(filePath, "utf8");
      expect(content, `${basename(filePath)} contains a legacy Status heading.`).not.toMatch(
        /^##\s+Status\s*$/m,
      );
      expect(content, `${basename(filePath)} contains a legacy Status bullet.`).not.toMatch(
        /^\s*-\s+\*\*Status:\*\*/m,
      );
    }
  });
});
