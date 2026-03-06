import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const renamedRegressionTests = [
  { file: "api-reference-docs.test.ts", issue: "Issue #842" },
  { file: "desktop-docs.test.ts", issue: "Issue #841" },
  { file: "memory-operator-workflows-docs.test.ts", issue: "Issue #666" },
  { file: "test-conventions-docs.test.ts", issue: "Issue #998" },
  { file: "ui-bootstrap-and-auth-docs.test.ts", issue: "Issue #568" },
];

describe("Docs regression test naming (Issue #999)", () => {
  it("uses behavior-based filenames while keeping issue references visible", async () => {
    const testFiles = await readdir(__dirname);
    const legacyIssueFiles = testFiles.filter((file) => /^issue-\d+.*\.test\.ts$/.test(file));

    expect(legacyIssueFiles).toEqual([]);

    for (const { file, issue } of renamedRegressionTests) {
      expect(testFiles).toContain(file);

      const source = await readFile(resolve(__dirname, file), "utf8");
      expect(source).toMatch(
        new RegExp(String.raw`describe\(\s*["'\`][^\n]*${escapeRegExp(issue)}`),
      );
      expect(basename(file, ".test.ts")).not.toMatch(/^issue-\d+/);
    }
  });
});
