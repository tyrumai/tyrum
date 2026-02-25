import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CI coverage summary parser", () => {
  it("does not double-escape regex tokens in the embedded Python", () => {
    const workflowPath = resolve(process.cwd(), ".github/workflows/ci.yml");
    const workflow = readFileSync(workflowPath, "utf8");

    const match = workflow.match(/python3 - <<'PY'\n([\s\S]*?)\n\s*PY\n/);
    expect(match, "expected to find python heredoc block").not.toBeNull();

    const python = match![1];

    expect(python).not.toContain("\\\\s");
    expect(python).not.toContain("\\\\d");
  });
});

