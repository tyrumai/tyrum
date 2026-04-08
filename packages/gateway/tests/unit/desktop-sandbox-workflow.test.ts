import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("desktop sandbox image workflow", () => {
  it("verifies published tags are anonymously pullable after push", () => {
    const workflowPath = fileURLToPath(
      new URL("../../../../.github/workflows/desktop-sandbox-image.yml", import.meta.url),
    );
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("Verify published tags are anonymously pullable");
    expect(workflow).toContain('DOCKER_CONFIG="${anon_config}" docker manifest inspect');
    expect(workflow).toContain("${{ steps.meta.outputs.tags }}");
  });
});
