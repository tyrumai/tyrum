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

function findStep(jobId: string, stepName: string): Record<string, unknown> | undefined {
  const workflow = readWorkflow();
  const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
  const job = jobs?.[jobId] as Record<string, unknown> | undefined;
  const steps = job?.["steps"] as Array<Record<string, unknown>> | undefined;
  return (steps ?? []).find((step) => step["name"] === stepName);
}

function findRunStep(jobId: string, runCommand: string): Record<string, unknown> | undefined {
  const workflow = readWorkflow();
  const jobs = workflow["jobs"] as Record<string, unknown> | undefined;
  const job = jobs?.[jobId] as Record<string, unknown> | undefined;
  const steps = job?.["steps"] as Array<Record<string, unknown>> | undefined;
  return (steps ?? []).find((step) => step["run"] === runCommand);
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

  expect(env?.["TYRUM_RUN_PACKAGED_SMOKE"]).toBe("1");
  expect(env?.["TYRUM_TRUST_PACKAGED_SMOKE_ARTIFACT"]).toBe("1");
  expect(env?.["CSC_FOR_PULL_REQUEST"]).toBe(
    "${{ matrix.os == 'macos-latest' && 'true' || 'false' }}",
  );
});

test("desktop build jobs pin the Electron install cache path for packaging reuse", () => {
  const linuxInstallStep = findRunStep("desktop-linux-build", "pnpm install --frozen-lockfile");
  const linuxBuildStep = findStep("desktop-linux-build", "Build desktop release files");
  const crossPlatformInstallStep = findRunStep(
    "desktop-cross-platform-build",
    "pnpm install --frozen-lockfile",
  );
  const crossPlatformBuildStep = findStep(
    "desktop-cross-platform-build",
    "Build desktop release files",
  );

  expect(
    (linuxInstallStep?.["env"] as Record<string, unknown> | undefined)?.["electron_config_cache"],
  ).toBe("${{ runner.temp }}/electron-cache");
  expect(
    (linuxBuildStep?.["env"] as Record<string, unknown> | undefined)?.["electron_config_cache"],
  ).toBe("${{ runner.temp }}/electron-cache");
  expect(
    (crossPlatformInstallStep?.["env"] as Record<string, unknown> | undefined)?.[
      "electron_config_cache"
    ],
  ).toBe("${{ runner.temp }}/electron-cache");
  expect(
    (crossPlatformBuildStep?.["env"] as Record<string, unknown> | undefined)?.[
      "electron_config_cache"
    ],
  ).toBe("${{ runner.temp }}/electron-cache");
});
