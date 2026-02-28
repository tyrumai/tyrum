import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SilentCatchLocation = {
  file: string;
  line: number;
};

const allowedCategories = new Set([
  "intentional",
  "needs-logging",
  "needs-rethrow",
  "needs-error-response",
]);

function getRepoRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  return path.resolve(dirname, "../../../..");
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolute)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(absolute);
    }
  }
  return files;
}

async function listSilentCatchLocations(): Promise<SilentCatchLocation[]> {
  const root = getRepoRoot();
  const srcDir = path.join(root, "packages/gateway/src");
  const files = await listFilesRecursively(srcDir);

  const locations: SilentCatchLocation[] = [];
  for (const file of files) {
    const rel = toPosixPath(path.relative(root, file));
    const contents = await fs.readFile(file, "utf8");
    const lines = contents.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (/\bcatch\s*\{/.test(lines[index] ?? "")) {
        locations.push({ file: rel, line: index + 1 });
      }
    }
  }

  locations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return locations;
}

function parseAuditDoc(
  auditMarkdown: string,
): Array<SilentCatchLocation & { category: string; notes: string }> {
  const rows: Array<SilentCatchLocation & { category: string; notes: string }> = [];
  const lines = auditMarkdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-{3,}\s*\|/.test(line)) continue;

    const trimmed = line.endsWith("|") ? line.slice(1, -1) : line.slice(1);
    const parts = trimmed.split("|").map((part) => part.trim());
    const file = parts[0] ?? "";
    const lineStr = parts[1] ?? "";
    const category = parts[2] ?? "";
    const notes = parts.slice(3).join(" | ").trim();

    if (!file.startsWith("packages/gateway/src/")) continue;
    const parsedLine = Number.parseInt(lineStr, 10);
    if (!Number.isFinite(parsedLine)) continue;

    rows.push({ file, line: parsedLine, category, notes });
  }

  rows.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return rows;
}

describe("silent-catch audit", () => {
  it("parses audit rows even when notes contain pipes or ---", () => {
    const auditMarkdown = [
      "| File | Line | Category | Notes |",
      "| --- | ---: | --- | --- |",
      "| packages/gateway/src/foo.ts | 1 | intentional | first | second --- third |",
    ].join("\n");

    expect(parseAuditDoc(auditMarkdown)).toEqual([
      {
        file: "packages/gateway/src/foo.ts",
        line: 1,
        category: "intentional",
        notes: "first | second --- third",
      },
    ]);
  });

  it("covers every silent catch block in packages/gateway/src", async () => {
    const root = getRepoRoot();
    const auditPath = path.join(root, "docs/audits/silent-catch-audit.md");
    const auditMarkdown = await fs.readFile(auditPath, "utf8");

    const expected = await listSilentCatchLocations();
    const actualRows = parseAuditDoc(auditMarkdown);

    expect(actualRows.length).toBeGreaterThan(0);
    for (const row of actualRows) {
      expect(allowedCategories.has(row.category)).toBe(true);
      expect(row.notes.trim().length).toBeGreaterThan(0);
    }

    const expectedKeys = expected.map((loc) => `${loc.file}:${loc.line}`);
    const actualKeys = actualRows.map((row) => `${row.file}:${row.line}`);
    expect(actualKeys).toEqual(expectedKeys);
  });
});
