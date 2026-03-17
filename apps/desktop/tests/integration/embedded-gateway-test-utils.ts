import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const REPO_ROOT = resolve(__dirname, "../../../../");
export const GATEWAY_BIN = resolve(REPO_ROOT, "packages/gateway/dist/index.mjs");
export const BUNDLED_OPERATOR_UI_DIR = resolve(REPO_ROOT, "packages/gateway/dist/ui");
export const BUNDLED_OPERATOR_UI_INDEX = resolve(BUNDLED_OPERATOR_UI_DIR, "index.html");
export const STAGED_GATEWAY_DIR = resolve(REPO_ROOT, "apps/desktop/dist/gateway");
export const STAGED_GATEWAY_BIN = resolve(STAGED_GATEWAY_DIR, "index.mjs");
export const STAGED_BUNDLED_OPERATOR_UI_INDEX = resolve(STAGED_GATEWAY_DIR, "dist/ui/index.html");
const STAGE_GATEWAY_BIN_SCRIPT = resolve(REPO_ROOT, "apps/desktop/scripts/stage-gateway-bin.mjs");
const electronPackageExport = require("electron");
if (typeof electronPackageExport !== "string") {
  throw new TypeError("Expected the electron package to export the executable path.");
}
const ELECTRON_BIN = electronPackageExport;
const CLI_UTILS_DIST = resolve(REPO_ROOT, "packages/cli-utils/dist/index.mjs");
const CLI_UTILS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/cli-utils/package.json");
const CLI_UTILS_TSCONFIG = resolve(REPO_ROOT, "packages/cli-utils/tsconfig.json");
const CLI_UTILS_SRC_DIR = resolve(REPO_ROOT, "packages/cli-utils/src");
const SCHEMAS_DIST = resolve(REPO_ROOT, "packages/schemas/dist/index.mjs");
const SCHEMAS_PACKAGE_JSON = resolve(REPO_ROOT, "packages/schemas/package.json");
const SCHEMAS_TSCONFIG = resolve(REPO_ROOT, "packages/schemas/tsconfig.json");
const SCHEMAS_SRC_DIR = resolve(REPO_ROOT, "packages/schemas/src");
const SCHEMAS_SCRIPTS_DIR = resolve(REPO_ROOT, "packages/schemas/scripts");
const GATEWAY_SRC_DIR = resolve(REPO_ROOT, "packages/gateway/src");
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");
export const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";
export const EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV = "TYRUM_EMBEDDED_GATEWAY_BUNDLE_SOURCE";
const DEFAULT_TENANT_ADMIN_TOKEN_PATTERN =
  /default-tenant-admin:\s*(tyrum-token\.v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/u;

const isCi = Boolean(process.env.CI?.trim());
const isWindows = process.platform === "win32";

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

function formatBuildFailure(prefix: string, result: ReturnType<typeof spawnSync>): string {
  const details = [
    prefix,
    result.error ? `spawn error: ${result.error.message}` : undefined,
    result.status === null ? "exit status: null" : `exit status: ${String(result.status)}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean);
  return details.join("\n");
}

function tryGatewayBuild(cmd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: isWindows,
  });
}

function waitForBuildOutputByAnotherWorker(outputPath: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(outputPath)) return true;
    sleepSync(200);
  }
  return existsSync(outputPath);
}

function latestMtimeInDir(rootDir: string): number {
  let latest = 0;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const mtimeMs = statSync(fullPath).mtimeMs;
      if (mtimeMs > latest) latest = mtimeMs;
    }
  }
  return latest;
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(GATEWAY_BIN)) return true;
  if (!existsSync(CLI_UTILS_DIST)) return true;
  if (!existsSync(SCHEMAS_DIST)) return true;
  if (!existsSync(BUNDLED_OPERATOR_UI_INDEX)) return true;

  const gatewayMtime = statSync(GATEWAY_BIN).mtimeMs;
  if (existsSync(GATEWAY_SRC_DIR) && gatewayMtime < latestMtimeInDir(GATEWAY_SRC_DIR)) return true;
  if (existsSync(CLI_UTILS_PACKAGE_JSON) && gatewayMtime < statSync(CLI_UTILS_PACKAGE_JSON).mtimeMs)
    return true;
  if (existsSync(CLI_UTILS_TSCONFIG) && gatewayMtime < statSync(CLI_UTILS_TSCONFIG).mtimeMs)
    return true;
  if (existsSync(CLI_UTILS_SRC_DIR) && gatewayMtime < latestMtimeInDir(CLI_UTILS_SRC_DIR))
    return true;
  if (existsSync(SCHEMAS_PACKAGE_JSON) && gatewayMtime < statSync(SCHEMAS_PACKAGE_JSON).mtimeMs)
    return true;
  if (existsSync(SCHEMAS_TSCONFIG) && gatewayMtime < statSync(SCHEMAS_TSCONFIG).mtimeMs)
    return true;
  if (existsSync(SCHEMAS_SRC_DIR) && gatewayMtime < latestMtimeInDir(SCHEMAS_SRC_DIR)) return true;
  if (existsSync(SCHEMAS_SCRIPTS_DIR) && gatewayMtime < latestMtimeInDir(SCHEMAS_SCRIPTS_DIR))
    return true;
  if (gatewayMtime < statSync(SCHEMAS_DIST).mtimeMs) return true;
  return gatewayMtime < statSync(CLI_UTILS_DIST).mtimeMs;
}

function stagedGatewayBuildIsStale(): boolean {
  if (!existsSync(STAGED_GATEWAY_BIN)) return true;
  if (!existsSync(STAGED_BUNDLED_OPERATOR_UI_INDEX)) return true;

  const stagedGatewayMtime = statSync(STAGED_GATEWAY_BIN).mtimeMs;
  const stagedOperatorUiMtime = statSync(STAGED_BUNDLED_OPERATOR_UI_INDEX).mtimeMs;
  if (stagedGatewayMtime < statSync(GATEWAY_BIN).mtimeMs) return true;
  if (stagedOperatorUiMtime < statSync(BUNDLED_OPERATOR_UI_INDEX).mtimeMs) return true;
  return existsSync(STAGE_GATEWAY_BIN_SCRIPT)
    ? stagedGatewayMtime < statSync(STAGE_GATEWAY_BIN_SCRIPT).mtimeMs
    : false;
}

function ensureWorkspaceBuild(
  filter: string,
  outputPath: string,
  failurePrefix: string,
  script = "build",
): void {
  const args = ["--filter", filter, script];
  const result = tryGatewayBuild("pnpm", args);
  if (result.status === 0 || existsSync(outputPath)) return;
  if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;

  if (result.error?.message.includes("ENOENT")) {
    const corepackResult = tryGatewayBuild("corepack", ["pnpm", ...args]);
    if (corepackResult.status === 0 || existsSync(outputPath)) return;
    if (waitForBuildOutputByAnotherWorker(outputPath, 5_000)) return;
    throw new Error(formatBuildFailure(failurePrefix, corepackResult));
  }

  throw new Error(formatBuildFailure(failurePrefix, result));
}

export function acquireGatewayBuildLock(timeoutMs = 180_000): () => void {
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
  ensureWorkspaceBuild(
    "@tyrum/schemas",
    SCHEMAS_DIST,
    "Failed to build @tyrum/schemas before desktop integration test.",
  );
  ensureWorkspaceBuild(
    "@tyrum/cli-utils",
    CLI_UTILS_DIST,
    "Failed to build @tyrum/cli-utils before desktop integration test.",
  );
  ensureWorkspaceBuild(
    "@tyrum/gateway",
    GATEWAY_BIN,
    "Failed to build @tyrum/gateway before desktop integration test.",
  );
}

export function ensureStagedGatewayBuild(): void {
  if (!stagedGatewayBuildIsStale()) return;
  ensureWorkspaceBuild(
    "tyrum-desktop",
    STAGED_GATEWAY_BIN,
    "Failed to stage tyrum-desktop embedded gateway before desktop integration test.",
    "build:gateway",
  );
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
