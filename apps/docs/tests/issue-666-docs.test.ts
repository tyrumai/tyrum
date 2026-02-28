import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Issue #666 docs", () => {
  it("documents Memory v1 operator workflows (inspect/export/forget)", async () => {
    const memoryDoc = await readFile(resolve(repoRoot, "docs/architecture/memory.md"), "utf8");

    expect(memoryDoc).toMatch(/## Operator workflows/i);
    expect(memoryDoc).toMatch(/memory\.list\b/);
    expect(memoryDoc).toMatch(/memory\.search\b/);
    expect(memoryDoc).toMatch(/memory\.get\b/);
    expect(memoryDoc).toMatch(/memory\.export\b/);
    expect(memoryDoc).toMatch(/\/memory\/exports\/:id\b/);
    expect(memoryDoc).toMatch(/memory\.forget\b/);
    expect(memoryDoc).toMatch(/tombstone/i);
    expect(memoryDoc).toMatch(/operator\.read\b/);
    expect(memoryDoc).toMatch(/operator\.write\b/);
  });

  it("does not document legacy /memory HTTP CRUD endpoints", async () => {
    const mdFiles = await listMarkdownFiles(resolve(repoRoot, "docs"));
    const legacyEndpointPattern = /\/memory\/(facts|events|capabilities|forget)\b/i;

    for (const file of mdFiles) {
      const content = await readFile(file, "utf8");
      expect(content).not.toMatch(legacyEndpointPattern);
    }
  });
});
