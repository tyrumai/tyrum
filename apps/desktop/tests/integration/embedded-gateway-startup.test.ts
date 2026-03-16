import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayManager } from "../../src/main/gateway-manager.js";
import {
  acquireGatewayBuildLock,
  BUNDLED_OPERATOR_UI_DIR,
  BUNDLED_OPERATOR_UI_INDEX,
  canRunPlaywright,
  electronCommand,
  EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV,
  ensureGatewayBuild,
  ensureOperatorShellVisible,
  ensureStagedGatewayBuild,
  findAvailablePort,
  formatBrowserFailure,
  GATEWAY_BIN,
  OPERATOR_UI_DIR_ENV,
  playwrightProbeError,
  skipPlaywrightTests,
  STAGED_BUNDLED_OPERATOR_UI_INDEX,
  STAGED_GATEWAY_DIR,
  stopChildProcess,
  waitForDefaultTenantAdminToken,
  waitForHealthDown,
  waitForHealthUp,
} from "./embedded-gateway-test-utils.js";

const itPlaywright = skipPlaywrightTests ? it.skip : it;

describe("desktop embedded gateway startup", () => {
  let manager: GatewayManager | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it(
    "starts embedded gateway via GatewayManager and passes health check",
    { timeout: 180_000 },
    async () => {
      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
      } finally {
        releaseBuildLock();
      }

      const port = await findAvailablePort();
      tempRoot = await mkdtemp(join(tmpdir(), "tyrum-desktop-gateway-"));
      const dbPath = join(tempRoot, "gateway.db");
      const healthUrl = `http://127.0.0.1:${port}/healthz`;

      manager = new GatewayManager();
      await manager.start({
        gatewayBin: GATEWAY_BIN,
        port,
        dbPath,
        accessToken: "desktop-integration-test-token",
        host: "127.0.0.1",
      });

      expect(manager.status).toBe("running");

      const response = await fetch(healthUrl);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");

      await manager.stop();
      expect(manager.status).toBe("stopped");
      await waitForHealthDown(healthUrl);
    },
  );

  itPlaywright(
    "serves bundled /ui assets and connects with the bootstrap token via the login form",
    { timeout: 90_000 },
    async () => {
      if (!canRunPlaywright) {
        throw new Error(
          `Playwright is required for this test but could not be launched: ${playwrightProbeError ?? "unknown error"}`,
        );
      }

      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
      } finally {
        releaseBuildLock();
      }

      if (!existsSync(BUNDLED_OPERATOR_UI_INDEX)) {
        throw new Error(
          `Missing bundled operator UI at ${BUNDLED_OPERATOR_UI_INDEX}. Run pnpm --filter @tyrum/gateway build first.`,
        );
      }

      const previousUiDir = process.env[OPERATOR_UI_DIR_ENV];
      process.env[OPERATOR_UI_DIR_ENV] = BUNDLED_OPERATOR_UI_DIR;

      const port = await findAvailablePort();
      tempRoot = await mkdtemp(join(tmpdir(), "tyrum-desktop-gateway-ui-"));
      const dbPath = join(tempRoot, "gateway.db");
      const targetUrl = `http://127.0.0.1:${port}/ui`;
      const gatewayLogs: string[] = [];

      let browser: (typeof import("playwright"))["Browser"] | undefined;
      let context: (typeof import("playwright"))["BrowserContext"] | undefined;
      let page: (typeof import("playwright"))["Page"] | undefined;

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      const httpErrors: string[] = [];

      try {
        manager = new GatewayManager();
        manager.on("log", (entry) => {
          gatewayLogs.push(`[${entry.level}] ${entry.message}`);
        });
        await manager.start({
          gatewayBin: GATEWAY_BIN,
          gatewayBinSource: "monorepo",
          port,
          dbPath,
          host: "127.0.0.1",
        });

        const token = manager.getBootstrapToken("default-tenant-admin");
        if (!token) {
          throw new Error("default-tenant-admin bootstrap token was not emitted by GatewayManager");
        }

        const pw = await import("playwright");
        browser = await pw.chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();

        page.on("console", (msg) => {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
          }
        });
        page.on("pageerror", (error) => {
          pageErrors.push(error.stack || error.message);
        });
        page.on("requestfailed", (req) => {
          requestFailures.push(
            `${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "unknown failure"}`,
          );
        });
        page.on("response", (res) => {
          if (res.status() >= 400) {
            httpErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
          }
        });

        const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        if (response && response.status() >= 400) {
          throw new Error(`navigation failed: HTTP ${String(response.status())} ${targetUrl}`);
        }

        await page.waitForSelector('[data-testid="login-token"]', {
          state: "visible",
          timeout: 10_000,
        });
        await page.getByTestId("login-token").fill(token);
        await page.getByTestId("login-button").click();
        await ensureOperatorShellVisible(page);

        expect(page.url()).toContain("/ui");
        expect(gatewayLogs.some((line) => line.includes("bundle_source=monorepo"))).toBe(true);
        expect(
          gatewayLogs.some((line) => line.includes(`assets_dir=${BUNDLED_OPERATOR_UI_DIR}`)),
        ).toBe(true);
      } catch (error) {
        throw new Error(
          formatBrowserFailure({
            url: page?.url() ?? targetUrl,
            consoleErrors,
            pageErrors,
            requestFailures,
            httpErrors,
            gatewayLogs,
          }),
          {
            cause: error instanceof Error ? error : undefined,
          },
        );
      } finally {
        await page?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);

        if (previousUiDir === undefined) {
          delete process.env[OPERATOR_UI_DIR_ENV];
        } else {
          process.env[OPERATOR_UI_DIR_ENV] = previousUiDir;
        }
      }
    },
  );

  itPlaywright(
    "boots a copied staged gateway artifact outside the workspace and connects via bundled /ui",
    { timeout: 240_000 },
    async () => {
      if (!canRunPlaywright) {
        throw new Error(
          `Playwright is required for this test but could not be launched: ${playwrightProbeError ?? "unknown error"}`,
        );
      }

      const releaseBuildLock = acquireGatewayBuildLock();
      try {
        ensureGatewayBuild();
        ensureStagedGatewayBuild();
      } finally {
        releaseBuildLock();
      }

      if (!existsSync(STAGED_BUNDLED_OPERATOR_UI_INDEX)) {
        throw new Error(
          `Missing staged bundled operator UI at ${STAGED_BUNDLED_OPERATOR_UI_INDEX}. Run pnpm --filter tyrum-desktop build:gateway first.`,
        );
      }

      tempRoot = await mkdtemp(join(tmpdir(), "tyrum-staged-gateway-artifact-"));
      const copiedGatewayDir = join(tempRoot, "gateway");
      const copiedGatewayBin = join(copiedGatewayDir, "index.mjs");
      const copiedMigrationsDir = join(copiedGatewayDir, "migrations/sqlite");
      const copiedBundledOperatorUiDir = join(copiedGatewayDir, "dist/ui");

      // Move the staged artifact outside the repo so the gateway cannot discover
      // workspace apps/web/dist and must resolve its packaged operator UI bundle.
      await cp(STAGED_GATEWAY_DIR, copiedGatewayDir, { recursive: true });

      const port = await findAvailablePort();
      const dbHome = join(tempRoot, "home");
      const dbPath = join(dbHome, "gateway.db");
      const healthUrl = `http://127.0.0.1:${port}/healthz`;
      const targetUrl = `http://127.0.0.1:${port}/ui`;
      const gatewayLogs: string[] = [];
      let stdout = "";
      let stderr = "";

      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        [EMBEDDED_GATEWAY_BUNDLE_SOURCE_ENV]: "staged",
      };
      delete childEnv[OPERATOR_UI_DIR_ENV];

      const child = spawn(
        electronCommand(),
        [
          copiedGatewayBin,
          "start",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--home",
          dbHome,
          "--db",
          dbPath,
          "--migrations-dir",
          copiedMigrationsDir,
        ],
        {
          cwd: copiedGatewayDir,
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        gatewayLogs.push(`[stdout] ${chunk.trimEnd()}`);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        gatewayLogs.push(`[stderr] ${chunk.trimEnd()}`);
      });

      let browser: (typeof import("playwright"))["Browser"] | undefined;
      let context: (typeof import("playwright"))["BrowserContext"] | undefined;
      let page: (typeof import("playwright"))["Page"] | undefined;
      let healthReached = false;
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      const httpErrors: string[] = [];
      const output = () => `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;

      try {
        await waitForHealthUp(healthUrl, child, output);
        healthReached = true;
        const token = await waitForDefaultTenantAdminToken(output, child);

        const pw = await import("playwright");
        browser = await pw.chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();

        page.on("console", (msg) => {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
          }
        });
        page.on("pageerror", (error) => {
          pageErrors.push(error.stack || error.message);
        });
        page.on("requestfailed", (req) => {
          requestFailures.push(
            `${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "unknown failure"}`,
          );
        });
        page.on("response", (res) => {
          if (res.status() >= 400) {
            httpErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
          }
        });

        const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        if (response && response.status() >= 400) {
          throw new Error(`navigation failed: HTTP ${String(response.status())} ${targetUrl}`);
        }

        await page.waitForSelector('[data-testid="login-token"]', {
          state: "visible",
          timeout: 10_000,
        });
        await page.getByTestId("login-token").fill(token);
        await page.getByTestId("login-button").click();
        await ensureOperatorShellVisible(page);

        expect(page.url()).toContain("/ui");
        expect(
          gatewayLogs.some((line) =>
            line.includes("bundle_source=staged assets_source=bundled-dist-ui"),
          ),
        ).toBe(true);
        expect(
          gatewayLogs.some((line) => line.includes(`assets_dir=${copiedBundledOperatorUiDir}`)),
        ).toBe(true);
      } catch (error) {
        throw new Error(
          formatBrowserFailure({
            url: page?.url() ?? targetUrl,
            consoleErrors,
            pageErrors,
            requestFailures,
            httpErrors,
            gatewayLogs: [...gatewayLogs, output()],
          }),
          {
            cause: error instanceof Error ? error : undefined,
          },
        );
      } finally {
        await page?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        await stopChildProcess(child);
        if (healthReached) {
          await waitForHealthDown(healthUrl).catch(() => undefined);
        }
      }
    },
  );
});
