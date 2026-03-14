import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatOperatorUiSmokeDiagnostics } from "../helpers/operator-ui-smoke-diagnostics.js";
import { pathExists } from "../helpers/path-exists.js";
import { startSmokeGateway } from "../e2e/smoke-turn-harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const OPERATOR_UI_DIST_DIR = resolve(REPO_ROOT, "apps/web/dist");
const OPERATOR_UI_DIST_INDEX = resolve(OPERATOR_UI_DIST_DIR, "index.html");

const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";

const isCi = Boolean(process.env.CI?.trim());

async function waitForBuiltOperatorUi(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await pathExists(OPERATOR_UI_DIST_INDEX)) {
      return true;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function snapshotBuiltOperatorUi(): Promise<string> {
  const snapshotDir = await mkdtemp(join(tmpdir(), "tyrum-operator-ui-smoke-"));
  await cp(OPERATOR_UI_DIST_DIR, snapshotDir, { recursive: true });
  return snapshotDir;
}

let canRunPlaywright = false;
let playwrightProbeError: string | undefined;
try {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  await browser.close();
  canRunPlaywright = true;
} catch (error) {
  playwrightProbeError = error instanceof Error ? error.message : String(error);
}

describe.skipIf(!canRunPlaywright && !isCi)("operator UI real-browser smoke (/ui)", () => {
  const prevUiDir = process.env[OPERATOR_UI_DIR_ENV];

  let stopGateway: (() => Promise<void>) | undefined;
  let operatorUiSnapshotDir: string | undefined;
  let browser: (typeof import("playwright"))["Browser"] | undefined;
  let context: (typeof import("playwright"))["BrowserContext"] | undefined;
  let page: (typeof import("playwright"))["Page"] | undefined;

  afterEach(async () => {
    await page?.close().catch(() => undefined);
    page = undefined;
    await context?.close().catch(() => undefined);
    context = undefined;
    await browser?.close().catch(() => undefined);
    browser = undefined;

    if (stopGateway) {
      const stop = stopGateway;
      stopGateway = undefined;
      await stop().catch(() => undefined);
    }

    if (operatorUiSnapshotDir) {
      await rm(operatorUiSnapshotDir, { recursive: true, force: true }).catch(() => undefined);
      operatorUiSnapshotDir = undefined;
    }

    if (prevUiDir === undefined) delete process.env[OPERATOR_UI_DIR_ENV];
    else process.env[OPERATOR_UI_DIR_ENV] = prevUiDir;
  });

  it("loads, authenticates, and scrubs token from URL", { timeout: 60_000 }, async () => {
    if (!canRunPlaywright) {
      throw new Error(
        `Playwright is required for this test but could not be launched: ${playwrightProbeError ?? "unknown error"}`,
      );
    }

    if (!(await waitForBuiltOperatorUi())) {
      throw new Error(
        `Missing operator UI build output at ${OPERATOR_UI_DIST_INDEX}. ` +
          `Run pnpm --filter @tyrum/web build (or pnpm build) before running this test.`,
      );
    }

    operatorUiSnapshotDir = await snapshotBuiltOperatorUi();
    process.env[OPERATOR_UI_DIR_ENV] = operatorUiSnapshotDir;

    const gateway = await startSmokeGateway({ modelReply: "operator-ui smoke" });
    stopGateway = gateway.stop;

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    const httpErrors: string[] = [];

    const pw = await import("playwright");
    browser = await pw.chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.stack || err.message);
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

    const targetUrl = `${gateway.baseUrl}/ui?token=${encodeURIComponent(gateway.adminToken)}`;

    try {
      const res = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      if (res && res.status() >= 400) {
        throw new Error(`navigation failed: HTTP ${String(res.status())} ${targetUrl}`);
      }

      const visibleUiState = await Promise.race([
        page
          .waitForSelector('[data-testid="nav-dashboard"]', {
            state: "visible",
            timeout: 30_000,
          })
          .then(() => "dashboard" as const),
        page
          .waitForSelector('[data-testid="first-run-onboarding"]', {
            state: "visible",
            timeout: 30_000,
          })
          .then(() => "onboarding" as const),
      ]);

      if (visibleUiState === "onboarding") {
        expect(await page.locator('[data-testid="nav-dashboard"]').count()).toBe(0);
        expect(await page.isVisible('[data-testid="first-run-onboarding"]')).toBe(true);
      }

      await page.waitForFunction(
        () => !new URL(window.location.href).searchParams.has("token"),
        undefined,
        { timeout: 10_000 },
      );

      const finalUrl = new URL(page.url());
      expect(finalUrl.pathname === "/ui" || finalUrl.pathname.startsWith("/ui/")).toBe(true);
      expect(finalUrl.searchParams.has("token")).toBe(false);
    } catch (error) {
      throw new Error(
        formatOperatorUiSmokeDiagnostics({
          url: page.url(),
          consoleErrors,
          pageErrors,
          requestFailures,
          httpErrors,
        }),
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  });
});
