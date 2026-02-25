import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function extractCoveragePythonHeredoc(workflow: string): string | null {
  const match = workflow.match(/python3 - <<'PY'\r?\n([\s\S]*?)\r?\n\s*PY\r?\n/);
  return match?.[1] ?? null;
}

function readCiWorkflow(): string {
  const workflowPath = resolve(process.cwd(), ".github/workflows/ci.yml");
  return readFileSync(workflowPath, "utf8");
}

describe("CI coverage summary parser", () => {
  it("does not double-escape regex tokens in the embedded Python", () => {
    const workflow = readCiWorkflow();

    const python = extractCoveragePythonHeredoc(workflow);
    expect(python, "expected to find python heredoc block").not.toBeNull();

    expect(python).not.toContain("\\\\s");
    expect(python).not.toContain("\\\\d");
  });

  it("uses the supported vitest coverage CLI flag combination", () => {
    const workflow = readCiWorkflow();

    const match = workflow.match(
      /- name: Test \+ coverage[\s\S]*?run:\s*>\r?\n([\s\S]*?)\r?\n\s*- name:/,
    );
    expect(match, "expected to find Test + coverage run block").not.toBeNull();

    const command = match![1];

    expect(command).toContain("--coverage.enabled");
    expect(command).toContain("--coverage.reporter=text-summary");
    expect(command).toContain("--coverage.reporter=html");
    expect(command).toContain("--coverage.reporter=clover");
    expect(command).not.toMatch(/(^|\s)--coverage(?=\s|$)/m);
  });

  it("finds the python heredoc when workflow line endings are CRLF", () => {
    const workflow = readCiWorkflow();
    const crlfWorkflow = workflow.replace(/\n/g, "\r\n");

    const python = extractCoveragePythonHeredoc(crlfWorkflow);
    expect(python, "expected to find python heredoc block under CRLF").not.toBeNull();
  });
});
