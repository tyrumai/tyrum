import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

function readWorkflow(): Record<string, unknown> {
  const workflowUrl = new URL(
    "../../../../.github/workflows/desktop-sandbox-image.yml",
    import.meta.url,
  );
  const workflowPath = fileURLToPath(workflowUrl);
  const workflowText = readFileSync(workflowPath, "utf8");
  return parse(workflowText) as Record<string, unknown>;
}

describe("desktop-sandbox image workflow", () => {
  test("publishes only the supported amd64 platform", () => {
    const workflow = readWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const buildJob = jobs?.["build"] as Record<string, unknown> | undefined;
    const steps = buildJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const qemuStep = (steps ?? []).find((step) => step["name"] === "Set up QEMU");
    const publishStep = (steps ?? []).find(
      (step) => step["name"] === "Build and optionally publish image",
    );

    expect(qemuStep).toBeUndefined();
    expect(publishStep).toBeTruthy();
    const withBlock = publishStep?.["with"] as Record<string, unknown> | undefined;
    expect(withBlock?.["platforms"]).toBe("linux/amd64");
  });
});
