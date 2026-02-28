import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const statusLinePattern =
  /^\s*-\s+\*\*Status:\*\*\s+(Implemented|Partially Implemented|Planned)\s*$/m;

function readSection(content: string, heading: string): string | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;

  const sectionLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

function expectArchitectureDocHasValidStatusSection(content: string, filePath: string): void {
  const statusSection = readSection(content, "Status");
  expect(statusSection, `${basename(filePath)} is missing a ## Status section.`).not.toBeNull();
  expect(statusSection, `${basename(filePath)} has an invalid ## Status section.`).toMatch(
    statusLinePattern,
  );
}

describe("Issue #840 docs", () => {
  it("shows the file name when a Status section is malformed", () => {
    const filePath = "/docs/architecture/invalid-status.md";
    const content = `# Invalid Status

## Status
- **Status:** Unknown
`;

    expect(() => {
      expectArchitectureDocHasValidStatusSection(content, filePath);
    }).toThrow(/invalid-status\.md/);
  });

  it("requires a Status section on every architecture doc", async () => {
    const docsDir = resolve(repoRoot, "docs/architecture");
    const markdownFiles = await listMarkdownFiles(docsDir);
    expect(markdownFiles.length).toBeGreaterThan(0);

    for (const filePath of markdownFiles) {
      const content = await readFile(filePath, "utf8");
      expectArchitectureDocHasValidStatusSection(content, filePath);
    }
  });
});
