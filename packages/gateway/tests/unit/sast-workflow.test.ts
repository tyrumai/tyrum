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
  expect(workflow).toContain("semgrep/semgrep:1.152.0@sha256:");
  expect(workflow).toMatch(/uses: github\/codeql-action\/upload-sarif@[0-9a-f]{40} # v4/u);
  expect(workflow).not.toMatch(/dorny\/paths-filter@v\d+/);
});
