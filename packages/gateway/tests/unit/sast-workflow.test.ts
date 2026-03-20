import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("SAST workflow exists and scopes to packages/apps", () => {
  const workflowUrl = new URL("../../../../.github/workflows/sast.yml", import.meta.url);
  const workflowPath = fileURLToPath(workflowUrl);

  expect(existsSync(workflowPath)).toBe(true);

  const workflow = readFileSync(workflowPath, "utf8");
  expect(workflow).toContain("name: sast");
  expect(workflow).toContain("pull_request");
  expect(workflow).toContain("push:");
  expect(workflow).toContain("branches: [main]");
  expect(workflow).toContain("paths:");
  expect(workflow).toContain("packages/**");
  expect(workflow).toContain("apps/**");
  expect(workflow).toContain("uses: github/codeql-action/upload-sarif@v4");
  expect(workflow).not.toMatch(/dorny\/paths-filter@v\d+/);
});
