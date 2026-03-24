import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, openSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOutputIsStale,
  ensureWorkspaceBuild,
  latestMtimeInDir,
} from "./workspace-build-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const REPO_ROOT = resolve(__dirname, "../../../../");
export const GATEWAY_BIN = resolve(REPO_ROOT, "packages/gateway/dist/index.mjs");
export const BUNDLED_OPERATOR_UI_DIR = resolve(REPO_ROOT, "packages/gateway/dist/ui");
export const BUNDLED_OPERATOR_UI_INDEX = resolve(BUNDLED_OPERATOR_UI_DIR, "index.html");
export const STAGED_GATEWAY_DIR = resolve(REPO_ROOT, "apps/desktop/dist/gateway");
export const STAGED_GATEWAY_BIN = resolve(STAGED_GATEWAY_DIR, "index.mjs");
export const DESKTOP_MAIN_ENTRYPOINT = resolve(REPO_ROOT, "apps/desktop/dist/main/bootstrap.mjs");
const DESKTOP_PRELOAD_ENTRYPOINT = resolve(REPO_ROOT, "apps/desktop/dist/preload/index.cjs");
const DESKTOP_RENDERER_ENTRY = resolve(REPO_ROOT, "apps/desktop/dist/renderer/index.html");
const DESKTOP_NODE_DIST_ENTRY = resolve(REPO_ROOT, "packages/desktop-node/dist/index.mjs");
function stagedRuntimeDist(packageName: string): string {
  return resolve(STAGED_GATEWAY_DIR, `node_modules/@tyrum/${packageName}/dist/index.mjs`);
}

export const STAGED_RUNTIME_NODE_CONTROL_DIST = stagedRuntimeDist("runtime-node-control");
export const STAGED_RUNTIME_EXECUTION_DIST = stagedRuntimeDist("runtime-execution");
export const STAGED_RUNTIME_AGENT_DIST = stagedRuntimeDist("runtime-agent");
export const STAGED_BUNDLED_OPERATOR_UI_INDEX = resolve(STAGED_GATEWAY_DIR, "dist/ui/index.html");
const STAGE_GATEWAY_BIN_SCRIPT = resolve(REPO_ROOT, "apps/desktop/scripts/stage-gateway-bin.mjs");
const DESKTOP_MAIN_SRC_DIR = resolve(REPO_ROOT, "apps/desktop/src/main");
const DESKTOP_PRELOAD_SRC_DIR = resolve(REPO_ROOT, "apps/desktop/src/preload");
const DESKTOP_RENDERER_SRC_DIR = resolve(REPO_ROOT, "apps/desktop/src/renderer");
const DESKTOP_PACKAGE_JSON = resolve(REPO_ROOT, "apps/desktop/package.json");
const DESKTOP_TSDOWN_CONFIG = resolve(REPO_ROOT, "apps/desktop/tsdown.config.ts");
const DESKTOP_VITE_CONFIG = resolve(REPO_ROOT, "apps/desktop/vite.config.ts");
const electronPackageExport = require("electron");
if (typeof electronPackageExport !== "string") {
  throw new TypeError("Expected the electron package to export the executable path.");
}
const ELECTRON_BIN = electronPackageExport;
const CLI_UTILS_DIST = resolve(REPO_ROOT, "packages/cli-utils/dist/index.mjs");
const CLI_UTILS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/cli-utils/package.json");
const CLI_UTILS_TSCONFIG = resolve(REPO_ROOT, "packages/cli-utils/tsconfig.json");
const CLI_UTILS_SRC_DIR = resolve(REPO_ROOT, "packages/cli-utils/src");
const CONTRACTS_DIST = resolve(REPO_ROOT, "packages/contracts/dist/index.mjs");
const CONTRACTS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/contracts/package.json");
const CONTRACTS_TSCONFIG = resolve(REPO_ROOT, "packages/contracts/tsconfig.json");
const CONTRACTS_SRC_DIR = resolve(REPO_ROOT, "packages/contracts/src");
const CONTRACTS_SCRIPTS_DIR = resolve(REPO_ROOT, "packages/contracts/scripts");
const RUNTIME_POLICY_DIST = resolve(REPO_ROOT, "packages/runtime-policy/dist/index.mjs");
const RUNTIME_POLICY_PACKAGE_JSON = resolve(REPO_ROOT, "packages/runtime-policy/package.json");
const RUNTIME_POLICY_TSCONFIG = resolve(REPO_ROOT, "packages/runtime-policy/tsconfig.json");
const RUNTIME_POLICY_SRC_DIR = resolve(REPO_ROOT, "packages/runtime-policy/src");
const GATEWAY_SRC_DIR = resolve(REPO_ROOT, "packages/gateway/src");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");
const RUNTIME_NODE_CONTROL_DIST = resolve(
  REPO_ROOT,
  "packages/runtime-node-control/dist/index.mjs",
);
const RUNTIME_NODE_CONTROL_PACKAGE_JSON = resolve(
  REPO_ROOT,
  "packages/runtime-node-control/package.json",
);
const RUNTIME_NODE_CONTROL_TSCONFIG = resolve(
  REPO_ROOT,
  "packages/runtime-node-control/tsconfig.json",
);
const RUNTIME_NODE_CONTROL_SRC_DIR = resolve(REPO_ROOT, "packages/runtime-node-control/src");
const RUNTIME_EXECUTION_DIST = resolve(REPO_ROOT, "packages/runtime-execution/dist/index.mjs");
const RUNTIME_EXECUTION_PACKAGE_JSON = resolve(
  REPO_ROOT,
  "packages/runtime-execution/package.json",
);
const RUNTIME_EXECUTION_TSCONFIG = resolve(REPO_ROOT, "packages/runtime-execution/tsconfig.json");
const RUNTIME_EXECUTION_SRC_DIR = resolve(REPO_ROOT, "packages/runtime-execution/src");
const RUNTIME_AGENT_DIST = resolve(REPO_ROOT, "packages/runtime-agent/dist/index.mjs");
const RUNTIME_AGENT_PACKAGE_JSON = resolve(REPO_ROOT, "packages/runtime-agent/package.json");
const RUNTIME_AGENT_TSCONFIG = resolve(REPO_ROOT, "packages/runtime-agent/tsconfig.json");
const RUNTIME_AGENT_SRC_DIR = resolve(REPO_ROOT, "packages/runtime-agent/src");
const DESKTOP_NODE_PACKAGE_JSON = resolve(REPO_ROOT, "packages/desktop-node/package.json");
const DESKTOP_NODE_TSCONFIG = resolve(REPO_ROOT, "packages/desktop-node/tsconfig.json");
const DESKTOP_NODE_TSDOWN_CONFIG = resolve(REPO_ROOT, "packages/desktop-node/tsdown.config.ts");
const DESKTOP_NODE_SRC_DIR = resolve(REPO_ROOT, "packages/desktop-node/src");
const GATEWAY_BUILD_DEPENDENCIES = [
  {
    filter: "@tyrum/contracts",
    outputPath: CONTRACTS_DIST,
    packageJsonPath: CONTRACTS_PACKAGE_JSON,
    tsconfigPath: CONTRACTS_TSCONFIG,
    sourceDirs: [CONTRACTS_SRC_DIR, CONTRACTS_SCRIPTS_DIR],
    failurePrefix: "Failed to build @tyrum/contracts before desktop integration test.",
  },
  {
    filter: "@tyrum/runtime-policy",
    outputPath: RUNTIME_POLICY_DIST,
    packageJsonPath: RUNTIME_POLICY_PACKAGE_JSON,
    tsconfigPath: RUNTIME_POLICY_TSCONFIG,
    sourceDirs: [RUNTIME_POLICY_SRC_DIR],
    failurePrefix: "Failed to build @tyrum/runtime-policy before desktop integration test.",
  },
  {
    filter: "@tyrum/cli-utils",
    outputPath: CLI_UTILS_DIST,
    packageJsonPath: CLI_UTILS_PACKAGE_JSON,
    tsconfigPath: CLI_UTILS_TSCONFIG,
    sourceDirs: [CLI_UTILS_SRC_DIR],
    failurePrefix: "Failed to build @tyrum/cli-utils before desktop integration test.",
  },
  {
    filter: "@tyrum/runtime-node-control",
    outputPath: RUNTIME_NODE_CONTROL_DIST,
    packageJsonPath: RUNTIME_NODE_CONTROL_PACKAGE_JSON,
    tsconfigPath: RUNTIME_NODE_CONTROL_TSCONFIG,
    sourceDirs: [RUNTIME_NODE_CONTROL_SRC_DIR],
    failurePrefix: "Failed to build @tyrum/runtime-node-control before desktop integration test.",
  },
  {
    filter: "@tyrum/runtime-execution",
    outputPath: RUNTIME_EXECUTION_DIST,
    packageJsonPath: RUNTIME_EXECUTION_PACKAGE_JSON,
    tsconfigPath: RUNTIME_EXECUTION_TSCONFIG,
    sourceDirs: [RUNTIME_EXECUTION_SRC_DIR],
    failurePrefix: "Failed to build @tyrum/runtime-execution before desktop integration test.",
  },
  {
    filter: "@tyrum/runtime-agent",
    outputPath: RUNTIME_AGENT_DIST,
    packageJsonPath: RUNTIME_AGENT_PACKAGE_JSON,
    tsconfigPath: RUNTIME_AGENT_TSCONFIG,
    sourceDirs: [RUNTIME_AGENT_SRC_DIR],
    failurePrefix: "Failed to build @tyrum/runtime-agent before desktop integration test.",
  },
] as const;
const STAGED_GATEWAY_BUILD_DEPENDENCIES = [
  {
    stagedPath: STAGED_RUNTIME_NODE_CONTROL_DIST,
    sourcePath: RUNTIME_NODE_CONTROL_DIST,
  },
  {
    stagedPath: STAGED_RUNTIME_EXECUTION_DIST,
    sourcePath: RUNTIME_EXECUTION_DIST,
  },
  {
    stagedPath: STAGED_RUNTIME_AGENT_DIST,
    sourcePath: RUNTIME_AGENT_DIST,
  },
] as const;
export const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";
export const EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV = "TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE";
const DEFAULT_TENANT_ADMIN_TOKEN_PATTERN =
  /default-tenant-admin:\s*(tyrum-token\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/u;
const gatewayBuildLockTimeoutMs = 600_000;

const isCi = Boolean(process.env.CI?.trim());

export let canRunPlaywright = false;
export let playwrightProbeError: string | undefined;
try {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  await browser.close();
  canRunPlaywright = true;
} catch (error) {
  playwrightProbeError = error instanceof Error ? error.message : String(error);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(GATEWAY_BIN) || !existsSync(BUNDLED_OPERATOR_UI_INDEX)) return true;

  const gatewayMtime = statSync(GATEWAY_BIN).mtimeMs;
  if (existsSync(GATEWAY_SRC_DIR) && gatewayMtime < latestMtimeInDir(GATEWAY_SRC_DIR)) return true;

  for (const dependency of GATEWAY_BUILD_DEPENDENCIES) {
    if (buildOutputIsStale(dependency)) return true;
    if (gatewayMtime < statSync(dependency.outputPath).mtimeMs) return true;
  }

  return false;
}

function stagedGatewayBuildIsStale(): boolean {
  if (!existsSync(STAGED_GATEWAY_BIN) || !existsSync(STAGED_BUNDLED_OPERATOR_UI_INDEX)) return true;

  const stagedGatewayMtime = statSync(STAGED_GATEWAY_BIN).mtimeMs;
  const stagedOperatorUiMtime = statSync(STAGED_BUNDLED_OPERATOR_UI_INDEX).mtimeMs;
  if (stagedGatewayMtime < statSync(GATEWAY_BIN).mtimeMs) return true;
  if (stagedOperatorUiMtime < statSync(BUNDLED_OPERATOR_UI_INDEX).mtimeMs) return true;

  for (const dependency of STAGED_GATEWAY_BUILD_DEPENDENCIES) {
    if (!existsSync(dependency.stagedPath)) return true;
    if (statSync(dependency.stagedPath).mtimeMs < statSync(dependency.sourcePath).mtimeMs) {
      return true;
    }
  }

  return existsSync(STAGE_GATEWAY_BIN_SCRIPT)
    ? stagedGatewayMtime < statSync(STAGE_GATEWAY_BIN_SCRIPT).mtimeMs
    : false;
}

function desktopMainBuildIsStale(): boolean {
  if (
    buildOutputIsStale({
      outputPath: DESKTOP_MAIN_ENTRYPOINT,
      packageJsonPath: DESKTOP_PACKAGE_JSON,
      sourceDirs: [DESKTOP_MAIN_SRC_DIR],
    })
  ) {
    return true;
  }

  return existsSync(DESKTOP_TSDOWN_CONFIG)
    ? statSync(DESKTOP_MAIN_ENTRYPOINT).mtimeMs < statSync(DESKTOP_TSDOWN_CONFIG).mtimeMs
    : false;
}

function desktopPreloadBuildIsStale(): boolean {
  if (
    buildOutputIsStale({
      outputPath: DESKTOP_PRELOAD_ENTRYPOINT,
      packageJsonPath: DESKTOP_PACKAGE_JSON,
      sourceDirs: [DESKTOP_PRELOAD_SRC_DIR],
    })
  ) {
    return true;
  }

  return existsSync(DESKTOP_TSDOWN_CONFIG)
    ? statSync(DESKTOP_PRELOAD_ENTRYPOINT).mtimeMs < statSync(DESKTOP_TSDOWN_CONFIG).mtimeMs
    : false;
}

function desktopRendererBuildIsStale(): boolean {
  if (
    buildOutputIsStale({
      outputPath: DESKTOP_RENDERER_ENTRY,
      packageJsonPath: DESKTOP_PACKAGE_JSON,
      sourceDirs: [DESKTOP_RENDERER_SRC_DIR],
    })
  ) {
    return true;
  }

  return existsSync(DESKTOP_VITE_CONFIG)
    ? statSync(DESKTOP_RENDERER_ENTRY).mtimeMs < statSync(DESKTOP_VITE_CONFIG).mtimeMs
    : false;
}

function desktopNodeBuildIsStale(): boolean {
  if (
    buildOutputIsStale({
      outputPath: DESKTOP_NODE_DIST_ENTRY,
      packageJsonPath: DESKTOP_NODE_PACKAGE_JSON,
      tsconfigPath: DESKTOP_NODE_TSCONFIG,
      sourceDirs: [DESKTOP_NODE_SRC_DIR],
    })
  ) {
    return true;
  }

  return existsSync(DESKTOP_NODE_TSDOWN_CONFIG)
    ? statSync(DESKTOP_NODE_DIST_ENTRY).mtimeMs < statSync(DESKTOP_NODE_TSDOWN_CONFIG).mtimeMs
    : false;
}

export function acquireGatewayBuildLock(timeoutMs = gatewayBuildLockTimeoutMs): () => void {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(GATEWAY_BUILD_LOCK, "wx");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(GATEWAY_BUILD_LOCK);
        } catch {
          // ignore
        }
      };
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
      if (code !== "EEXIST") throw err;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for gateway build lock (${timeoutMs}ms): ${GATEWAY_BUILD_LOCK}`,
        );
      }
      sleepSync(200);
    }
  }
}

export function ensureGatewayBuild(): void {
  if (!gatewayBuildIsStale()) return;
  for (const dependency of GATEWAY_BUILD_DEPENDENCIES) {
    ensureWorkspaceBuild({
      repoRoot: REPO_ROOT,
      filter: dependency.filter,
      outputPath: dependency.outputPath,
      failurePrefix: dependency.failurePrefix,
    });
  }
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "@tyrum/gateway",
    outputPath: GATEWAY_BIN,
    failurePrefix: "Failed to build @tyrum/gateway before desktop integration test.",
  });
}

export function ensureStagedGatewayBuild(): void {
  if (!stagedGatewayBuildIsStale()) return;
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "tyrum-desktop",
    outputPath: STAGED_GATEWAY_BIN,
    failurePrefix:
      "Failed to stage tyrum-desktop embedded gateway before desktop integration test.",
    script: "build:gateway",
  });
}

export function ensureDesktopMainBuild(): void {
  if (!desktopMainBuildIsStale()) return;
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "tyrum-desktop",
    outputPath: DESKTOP_MAIN_ENTRYPOINT,
    failurePrefix:
      "Failed to build tyrum-desktop main entrypoints before desktop integration test.",
    script: "build:main",
  });
}

export function ensureDesktopPreloadBuild(): void {
  if (!desktopPreloadBuildIsStale()) return;
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "tyrum-desktop",
    outputPath: DESKTOP_PRELOAD_ENTRYPOINT,
    failurePrefix:
      "Failed to build tyrum-desktop preload entrypoints before desktop integration test.",
    script: "build:preload",
  });
}

export function ensureDesktopRendererBuild(): void {
  if (!desktopRendererBuildIsStale()) return;
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "tyrum-desktop",
    outputPath: DESKTOP_RENDERER_ENTRY,
    failurePrefix: "Failed to build tyrum-desktop renderer before desktop integration test.",
    script: "build:renderer",
  });
}

export function ensureDesktopNodeBuild(): void {
  if (!desktopNodeBuildIsStale()) return;
  ensureWorkspaceBuild({
    repoRoot: REPO_ROOT,
    filter: "@tyrum/desktop-node",
    outputPath: DESKTOP_NODE_DIST_ENTRY,
    failurePrefix: "Failed to build @tyrum/desktop-node before desktop integration test.",
  });
}

export async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => rejectPort(new Error("Unable to allocate free port")));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? rejectPort(error) : resolvePort(port)));
    });
  });
}

export async function waitForHealthDown(url: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Gateway still reachable after stop timeout (${timeoutMs}ms): ${url}`);
}

export function electronCommand(): string {
  return ELECTRON_BIN;
}

export async function waitForHealthUp(
  url: string,
  child: ChildProcessWithoutNullStreams,
  output: () => string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `staged gateway exited before becoming healthy (code=${String(child.exitCode)}, signal=${String(child.signalCode)})\n${output()}`,
      );
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
        continue;
      }
      const body = (await response.json()) as { status?: string };
      if (body.status === "ok") return;
    } catch {
      // The gateway may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`staged gateway did not become healthy within ${timeoutMs}ms\n${output()}`);
}

function extractDefaultTenantAdminToken(output: string): string | undefined {
  return DEFAULT_TENANT_ADMIN_TOKEN_PATTERN.exec(output)?.[1];
}

export async function waitForDefaultTenantAdminToken(
  output: () => string,
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = extractDefaultTenantAdminToken(output());
    if (token) return token;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `staged gateway exited before emitting default-tenant-admin token (code=${String(child.exitCode)}, signal=${String(child.signalCode)})\n${output()}`,
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `staged gateway did not emit a default-tenant-admin token within ${timeoutMs}ms\n${output()}`,
  );
}

export async function stopChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 5_000);
    const forceResolveTimer = setTimeout(() => {
      clearTimeout(killTimer);
      resolveStop();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      clearTimeout(forceResolveTimer);
      resolveStop();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      clearTimeout(forceResolveTimer);
      resolveStop();
    }
  });
}

export async function ensureOperatorShellVisible(
  page: (typeof import("playwright"))["Page"],
  timeoutMs = process.platform === "win32" ? 60_000 : 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const visibleUiState = await Promise.race([
      page
        .waitForSelector('[data-testid="nav-chat"]', { state: "visible", timeout: 1_000 })
        .then(() => "shell" as const),
      page
        .waitForSelector('[data-testid="first-run-onboarding"]', {
          state: "visible",
          timeout: 1_000,
        })
        .then(() => "onboarding" as const),
    ]).catch(() => null);

    if (visibleUiState === "shell") return;
    if (visibleUiState === "onboarding") {
      await page.getByRole("button", { name: "Skip setup" }).click();
    }
  }
  throw new Error(`operator shell did not become visible within ${timeoutMs}ms`);
}

export function formatBrowserFailure(input: {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  httpErrors: string[];
  gatewayLogs: string[];
}): string {
  return [
    `url=${input.url}`,
    input.consoleErrors.length > 0 ? `console=${input.consoleErrors.join("\n")}` : undefined,
    input.pageErrors.length > 0 ? `page=${input.pageErrors.join("\n")}` : undefined,
    input.requestFailures.length > 0 ? `requests=${input.requestFailures.join("\n")}` : undefined,
    input.httpErrors.length > 0 ? `http=${input.httpErrors.join("\n")}` : undefined,
    input.gatewayLogs.length > 0 ? `gateway=${input.gatewayLogs.join("\n")}` : undefined,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n---\n");
}

export const skipPlaywrightTests = !canRunPlaywright && !isCi;
