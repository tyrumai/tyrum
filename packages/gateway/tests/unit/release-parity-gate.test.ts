import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const RELEASE_PACKAGES = [
  {
    name: "@tyrum/contracts",
    manifestPath: "packages/contracts/package.json",
    packageDir: "packages/contracts",
    tarball: "tyrum-contracts-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/cli-utils",
    manifestPath: "packages/cli-utils/package.json",
    packageDir: "packages/cli-utils",
    tarball: "tyrum-cli-utils-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/runtime-policy",
    manifestPath: "packages/runtime-policy/package.json",
    packageDir: "packages/runtime-policy",
    tarball: "tyrum-runtime-policy-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/runtime-node-control",
    manifestPath: "packages/runtime-node-control/package.json",
    packageDir: "packages/runtime-node-control",
    tarball: "tyrum-runtime-node-control-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/runtime-execution",
    manifestPath: "packages/runtime-execution/package.json",
    packageDir: "packages/runtime-execution",
    tarball: "tyrum-runtime-execution-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/runtime-agent",
    manifestPath: "packages/runtime-agent/package.json",
    packageDir: "packages/runtime-agent",
    tarball: "tyrum-runtime-agent-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/runtime-workboard",
    manifestPath: "packages/runtime-workboard/package.json",
    packageDir: "packages/runtime-workboard",
    tarball: "tyrum-runtime-workboard-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/transport-sdk",
    manifestPath: "packages/transport-sdk/package.json",
    packageDir: "packages/transport-sdk",
    tarball: "tyrum-transport-sdk-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/node-sdk",
    manifestPath: "packages/node-sdk/package.json",
    packageDir: "packages/node-sdk",
    tarball: "tyrum-node-sdk-${RELEASE_VERSION}.tgz",
  },
  {
    name: "@tyrum/gateway",
    manifestPath: "packages/gateway/package.json",
    packageDir: "packages/gateway",
    tarball: "tyrum-gateway-${RELEASE_VERSION}.tgz",
  },
] as const;

const RELEASE_PACKAGE_NAMES = new Set(RELEASE_PACKAGES.map((pkg) => pkg.name));
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function readReleaseWorkflow(): Record<string, unknown> {
  const workflowPath = join(REPO_ROOT, ".github/workflows/release.yml");
  const workflowText = readFileSync(workflowPath, "utf8");
  return parse(workflowText) as Record<string, unknown>;
}

function readJsonObject(relativePath: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function normalizeNeeds(needs: unknown): string[] {
  if (typeof needs === "string") return [needs];
  if (Array.isArray(needs)) return needs.filter((value) => typeof value === "string");
  return [];
}

function workspaceDependencyNames(manifest: Record<string, unknown>): string[] {
  const names = new Set<string>();

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        names.add(name);
      }
    }
  }

  return [...names].toSorted();
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

  it("stamps every release npm package manifest before packing", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const packageJob = jobs?.["package-bundles"] as Record<string, unknown> | undefined;
    const steps = packageJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const versionStep = (steps ?? []).find(
      (step) => step["name"] === "Apply tag version to workspace manifests",
    );
    expect(typeof versionStep?.["run"]).toBe("string");
    const runScript = String(versionStep?.["run"] ?? "");

    for (const pkg of RELEASE_PACKAGES) {
      expect(runScript).toContain(`"${pkg.manifestPath}"`);
    }
  });

  it("packs every release npm package tarball", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const packageJob = jobs?.["package-bundles"] as Record<string, unknown> | undefined;
    const steps = packageJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const packStep = (steps ?? []).find((step) => step["name"] === "Pack npm tarballs");
    expect(typeof packStep?.["run"]).toBe("string");
    const runScript = String(packStep?.["run"] ?? "");

    for (const pkg of RELEASE_PACKAGES) {
      expect(runScript).toContain(pkg.packageDir);
    }
  });

  it("publishes every release npm package tarball in dependency order", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const releaseJob = jobs?.["publish-release"] as Record<string, unknown> | undefined;
    const steps = releaseJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const publishStep = (steps ?? []).find((step) => step["name"] === "Publish npm packages");
    expect(typeof publishStep?.["run"]).toBe("string");
    const runScript = String(publishStep?.["run"] ?? "");

    let previousIndex = -1;
    for (const pkg of RELEASE_PACKAGES) {
      const entry = `"${pkg.name}|release-assets/${pkg.tarball}"`;
      const index = runScript.indexOf(entry);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("does not publish packages that depend on unpublished workspace packages", () => {
    for (const pkg of RELEASE_PACKAGES) {
      const manifest = readJsonObject(pkg.manifestPath);
      const workspaceDependencies = workspaceDependencyNames(manifest);

      for (const dependencyName of workspaceDependencies) {
        expect(
          RELEASE_PACKAGE_NAMES.has(dependencyName),
          `${pkg.name} depends on ${dependencyName}`,
        ).toBe(true);
      }
    }
  });

  it("builds only the publishable workspace package closure before packing tarballs", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const packageJob = jobs?.["package-bundles"] as Record<string, unknown> | undefined;
    const steps = packageJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const buildStep = (steps ?? []).find(
      (step) => step["name"] === "Build publishable workspace packages",
    );
    expect(typeof buildStep?.["run"]).toBe("string");
    const runScript = String(buildStep?.["run"] ?? "");

    expect(runScript).toContain("pnpm --filter @tyrum/gateway... build");
    expect(runScript).toContain("pnpm --filter @tyrum/node-sdk... build");
    expect(runScript).not.toMatch(/(?:^|\n)pnpm build(?:\n|$)/);
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
