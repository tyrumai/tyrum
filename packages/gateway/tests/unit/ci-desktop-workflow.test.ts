import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse } from "yaml";

function readWorkflow(): Record<string, unknown> {
  const workflowPath = fileURLToPath(
    new URL("../../../../.github/workflows/ci.yml", import.meta.url),
  );
  return parse(readFileSync(workflowPath, "utf8")) as Record<string, unknown>;
}

function readWorkflowSource(): string {
  const workflowPath = fileURLToPath(
    new URL("../../../../.github/workflows/ci.yml", import.meta.url),
  );
  return readFileSync(workflowPath, "utf8");
}

function findStep(jobId: string, stepName: string): Record<string, unknown> | undefined {
  const workflow = readWorkflow();
  const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
  const job = jobs?.[jobId] as Record<string, unknown> | undefined;
  const steps = job?.["steps"] as Array<Record<string, unknown>> | undefined;
  return (steps ?? []).find((step) => step["name"] === stepName);
}

test("desktop CI build jobs mark packaged bundles for smoke reuse", () => {
  const linuxStep = findStep(
    "desktop-linux-build",
    "Mark packaged desktop bundle ready for smoke reuse",
  );
  const crossPlatformStep = findStep(
    "desktop-cross-platform-build",
    "Mark packaged desktop bundle ready for smoke reuse",
  );

  expect(linuxStep?.["run"]).toBe("node apps/desktop/scripts/write-packaged-smoke-stamp.mjs");
  expect(crossPlatformStep?.["run"]).toBe(
    "node apps/desktop/scripts/write-packaged-smoke-stamp.mjs",
  );
});

test("desktop cross-platform test job trusts restored packaged artifacts", () => {
  const testStep = findStep("desktop-cross-platform-test", "Test desktop suite");
  const env = testStep?.["env"] as Record<string, unknown> | undefined;
  const verifyStep = findStep("desktop-cross-platform-test", "Verify restored macOS app signature");

  expect(env?.["TYRUM_RUN_PACKAGED_SMOKE"]).toBe("1");
  expect(env?.["TYRUM_TRUST_PACKAGED_SMOKE_ARTIFACT"]).toBe("1");
  expect(env?.["CSC_FOR_PULL_REQUEST"]).toBe(
    "${{ matrix.os == 'macos-latest' && 'true' || 'false' }}",
  );
  expect(verifyStep?.["if"]).toBe("matrix.os == 'macos-latest'");
  expect(verifyStep?.["run"]).toBe(
    "codesign --verify --deep --strict apps/desktop/release/mac-arm64/Tyrum.app",
  );
});

test("desktop CI workflow does not depend on a temporary Electron cache path", () => {
  expect(readWorkflowSource()).not.toContain("electron_config_cache");
});

test("desktop cross-platform Electron preflight launches the runtime", () => {
  const electronStep = findStep(
    "desktop-cross-platform-test",
    "Ensure Electron binary is installed",
  );
  const run = String(electronStep?.["run"]);

  expect(run).toContain('childProcess.spawnSync(electronPath, ["--version"]');
  expect(run).toContain('return process.platform !== "win32"');
  expect(run).toContain('"ditto",');
  expect(run).toContain('require.resolve("@electron/get", { paths: [electronDir] })');
  expect(run).toContain("Electron runtime probe failed before reinstall");
  expect(run).toContain("Installed Electron dist is not launchable");
});

test("desktop Linux test force-installs a real Electron runtime", () => {
  const electronStep = findStep("desktop-linux-test", "Ensure Electron binary is installed");
  const run = String(electronStep?.["run"]);

  expect(run).toContain('childProcess.spawnSync(electronPath, ["--version"]');
  expect(run).toContain('require.resolve("@electron/get", { paths: [electronDir] })');
  expect(run).toContain("downloadArtifact({");
  expect(run).toContain('childProcess.spawnSync("unzip"');
  expect(run).toContain('fs.writeFileSync(path.join(electronDir, "path.txt"), targetName)');
  expect(run).not.toContain("apps/desktop/release/linux-unpacked/tyrum-desktop");
  expect(run).not.toContain("symlinkSync(packagedExecutable");
});

test("browser-backed gateway smokes run only in the Playwright-enabled Linux browser suite", () => {
  const source = readWorkflowSource();

  expect(source).toContain(
    "--exclude=packages/gateway/tests/integration/operator-ui-browser-https-smoke.test.ts",
  );
  expect(source).toContain(
    "packages/gateway/tests/integration/operator-ui-browser-https-smoke.test.ts",
  );

  const browserSuiteStep = findStep("linux-browser-suite", "Run browser-backed Linux suite");
  expect(typeof browserSuiteStep?.["run"]).toBe("string");
  expect(String(browserSuiteStep?.["run"])).toContain(
    "packages/gateway/tests/integration/operator-ui-browser-https-smoke.test.ts",
  );
});
