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

function readText(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
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

function releaseStep(stepName: string): Record<string, unknown> | undefined {
  const workflow = readReleaseWorkflow();
  const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
  const desktopJob = jobs?.["desktop-bundles"] as Record<string, unknown> | undefined;
  const steps = desktopJob?.["steps"] as Array<Record<string, unknown>> | undefined;
  return (steps ?? []).find((step) => step["name"] === stepName);
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

  it("rejects release tags that would not become valid SemVer versions", () => {
    const workflow = readReleaseWorkflow();
    const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
    const packageJob = jobs?.["package-bundles"] as Record<string, unknown> | undefined;
    const steps = packageJob?.["steps"] as Array<Record<string, unknown>> | undefined;

    const versionStep = (steps ?? []).find((step) => step["id"] === "version");
    expect(typeof versionStep?.["run"]).toBe("string");
    const runScript = String(versionStep?.["run"] ?? "");
    const releaseTagPattern = String.raw`^v[0-9]{4}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])(-(beta|dev)\.(0|[1-9][0-9]*))?$`;

    expect(runScript).toContain(releaseTagPattern);
    expect(runScript).toContain("SemVer-compatible calendar tag");
    expect(runScript).toContain("Do not zero-pad month, day, or prerelease number.");

    const tagRegex =
      /^v[0-9]{4}\.([1-9]|1[0-2])\.([1-9]|[12][0-9]|3[01])(-(beta|dev)\.(0|[1-9][0-9]*))?$/;

    expect(tagRegex.test("v2026.5.29")).toBe(true);
    expect(tagRegex.test("v2026.5.29-dev.2")).toBe(true);
    expect(tagRegex.test("v2026.5.29-beta.0")).toBe(true);
    expect(tagRegex.test("v2026.05.29-dev.2")).toBe(false);
    expect(tagRegex.test("v2026.5.09-dev.2")).toBe(false);
    expect(tagRegex.test("v2026.5.29-dev.02")).toBe(false);
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

  it("keeps dev prerelease macOS bundles out of production signing and notarization", () => {
    const signedBuildStep = releaseStep("Build desktop release files (macOS signed + notarized)");
    const devBuildStep = releaseStep("Build desktop release files (macOS dev prerelease)");

    expect(signedBuildStep?.["if"]).toBe(
      "${{ matrix.os == 'macos-latest' && needs.package-bundles.outputs.channel != 'dev' }}",
    );
    expect(devBuildStep?.["if"]).toBe(
      "${{ matrix.os == 'macos-latest' && needs.package-bundles.outputs.channel == 'dev' }}",
    );

    const devEnv = devBuildStep?.["env"] as Record<string, unknown> | undefined;
    expect(devEnv?.["CSC_IDENTITY_AUTO_DISCOVERY"]).toBe("false");
    expect(JSON.stringify(devEnv ?? {})).not.toContain("secrets.");
  });

  it("runs release packaged smoke against the just-built desktop bundle only", () => {
    const markerStep = releaseStep("Mark packaged desktop bundle ready for smoke reuse");
    const smokeStep = releaseStep("Smoke test packaged desktop app");

    expect(markerStep?.["run"]).toBe("node apps/desktop/scripts/write-packaged-smoke-stamp.mjs");

    const env = smokeStep?.["env"] as Record<string, unknown> | undefined;
    expect(env?.["TYRUM_RUN_PACKAGED_SMOKE"]).toBe("1");
    expect(env?.["TYRUM_PACKAGED_SMOKE_ONLY"]).toBe("1");
    expect(env?.["TYRUM_TRUST_PACKAGED_SMOKE_ARTIFACT"]).toBe("1");
  });

  it("does not require the dev Electron binary for packaged-only smoke imports", () => {
    const smokeSource = readText("apps/desktop/tests/integration/electron-process-smoke.test.ts");
    const testUtilsSource = readText(
      "apps/desktop/tests/integration/embedded-gateway-test-utils.ts",
    );

    expect(smokeSource).toContain('process.env["TYRUM_PACKAGED_SMOKE_ONLY"] === "1"');
    expect(smokeSource).toContain("Electron runtime probe skipped for packaged-only smoke.");
    expect(smokeSource).toContain("const CAN_LAUNCH_PACKAGED_APP");
    expect(smokeSource).not.toContain("it.skipIf(!CAN_LAUNCH_ELECTRON || !PACKAGED_SMOKE_ENABLED)");

    const electronCommandIndex = testUtilsSource.indexOf("export function electronCommand");
    expect(electronCommandIndex).toBeGreaterThan(0);
    expect(testUtilsSource.slice(0, electronCommandIndex)).not.toContain('require("electron")');
    expect(testUtilsSource.slice(electronCommandIndex)).toContain(
      'const electronPackageExport = require("electron");',
    );
  });
});
