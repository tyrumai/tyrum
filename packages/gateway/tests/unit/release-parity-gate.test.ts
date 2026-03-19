import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

function readReleaseWorkflow(): Record<string, unknown> {
  const workflowPath = fileURLToPath(
    new URL("../../../../.github/workflows/release.yml", import.meta.url),
  );
  const workflowText = readFileSync(workflowPath, "utf8");
  return parse(workflowText) as Record<string, unknown>;
}

function normalizeNeeds(needs: unknown): string[] {
  if (typeof needs === "string") return [needs];
  if (Array.isArray(needs)) return needs.filter((value) => typeof value === "string");
  return [];
}

describe("release workflow parity gate", () => {
  it("blocks packaging until architecture parity gate passes", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    expect(jobs).toBeTruthy();

    const gateJob = jobs?.["architecture-parity-gate"] as Record<string, unknown> | undefined;
    expect(gateJob).toBeTruthy();

    const packageJob = jobs?.["package-bundles"] as Record<string, unknown> | undefined;
    expect(packageJob).toBeTruthy();

    const needs = normalizeNeeds(packageJob?.["needs"]);
    expect(needs).toContain("architecture-parity-gate");
  });

  it("checks that CI parity workflow succeeded for the release SHA", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const gateJob = jobs?.["architecture-parity-gate"] as Record<string, unknown> | undefined;
    const steps = gateJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const gateStep = (steps ?? []).find(
      (step) => step["name"] === "Wait for CI parity checks to succeed",
    );
    expect(typeof gateStep?.["run"]).toBe("string");
    const runScript = String(gateStep?.["run"] ?? "");

    expect(runScript).toContain("actions/workflows/ci.yml/runs");
    expect(runScript).toContain("head_sha=");
    expect(runScript).toContain("GITHUB_SHA");
    expect(runScript).toContain("conclusion");
    expect(runScript).toContain("while true; do");
    expect(runScript).toMatch(/\n\s*done\s*(\n|$)/);
  });

  it("publishes the packed npm tarballs that match the renamed workspace packages", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const releaseJob = jobs?.["publish-release"] as Record<string, unknown> | undefined;
    const steps = releaseJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const publishStep = (steps ?? []).find((step) => step["name"] === "Publish npm packages");
    expect(typeof publishStep?.["run"]).toBe("string");
    const runScript = String(publishStep?.["run"] ?? "");

    expect(runScript).toContain(
      '["@tyrum/contracts"]="release-assets/tyrum-contracts-${RELEASE_VERSION}.tgz"',
    );
    expect(runScript).toContain(
      '["@tyrum/client"]="release-assets/tyrum-client-${RELEASE_VERSION}.tgz"',
    );
    expect(runScript).toContain(
      '["@tyrum/gateway"]="release-assets/tyrum-gateway-${RELEASE_VERSION}.tgz"',
    );
  });

  it("does not leak macOS code-signing secrets into Windows desktop builds", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const desktopJob = jobs?.["desktop-bundles"] as Record<string, unknown> | undefined;
    const steps = desktopJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const windowsBuildStep = (steps ?? []).find(
      (step) => step["name"] === "Build desktop release files (Windows)",
    );

    expect(windowsBuildStep).toBeTruthy();

    const env = windowsBuildStep?.["env"] as Record<string, unknown> | undefined;
    expect(env).toBeTruthy();

    expect(env).not.toHaveProperty("CSC_LINK");
    expect(env?.["WIN_CSC_LINK"]).toBe("${{ secrets.WIN_CSC_LINK }}");
    expect(env).not.toHaveProperty("CSC_KEY_PASSWORD");
    expect(env?.["WIN_CSC_KEY_PASSWORD"]).toBe("${{ secrets.WIN_CSC_KEY_PASSWORD }}");

    const envText = JSON.stringify(env ?? {});
    expect(envText).not.toContain("secrets.CSC_LINK");
    expect(envText).not.toContain("secrets.CSC_KEY_PASSWORD");
  });
});
