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
const SNAPSHOT_COPY_RETRY_LIMIT = 20;
const SNAPSHOT_COPY_RETRY_MS = 100;

const isCi = Boolean(process.env.CI?.trim());

type BrowserSmokePairing = {
  status: string;
  trust_level?: string;
  node?: {
    metadata?: {
      mode?: string;
    };
  };
};

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

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function snapshotBuiltOperatorUi(): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const snapshotDir = await mkdtemp(join(tmpdir(), "tyrum-operator-ui-smoke-"));
    try {
      await cp(OPERATOR_UI_DIST_DIR, snapshotDir, { recursive: true });
      return snapshotDir;
    } catch (error) {
      await rm(snapshotDir, { recursive: true, force: true });
      if (!isMissingPathError(error) || attempt >= SNAPSHOT_COPY_RETRY_LIMIT) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, SNAPSHOT_COPY_RETRY_MS));
    }
  }
}

function assertPlaywrightAvailable(): void {
  if (!canRunPlaywright) {
    throw new Error(
      `Playwright is required for this test but could not be launched: ${playwrightProbeError ?? "unknown error"}`,
    );
  }
}

function registerBrowserDiagnostics(input: {
  consoleErrors: string[];
  httpErrors: string[];
  page: (typeof import("playwright"))["Page"];
  pageErrors: string[];
  requestFailures: string[];
}): void {
  input.page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      input.consoleErrors.push(`[console.${msg.type()}] ${msg.text()}`);
    }
  });
  input.page.on("pageerror", (err) => {
    input.pageErrors.push(err.stack || err.message);
  });
  input.page.on("requestfailed", (req) => {
    input.requestFailures.push(
      `${req.method()} ${req.url()} - ${req.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  input.page.on("response", (res) => {
    if (res.status() >= 400) {
      input.httpErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
}

async function waitForApprovedBrowserNodePairing(input: {
  baseUrl: string;
  timeoutMs?: number;
  token: string;
}): Promise<BrowserSmokePairing> {
  const timeoutMs = input.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  let lastObservedSummary = "none";

  while (Date.now() <= deadline) {
    const response = await fetch(`${input.baseUrl}/pairings`, {
      headers: { authorization: `Bearer ${input.token}` },
    });
    if (!response.ok) {
      throw new Error(`pairings request failed: HTTP ${String(response.status)}`);
    }

    const body = (await response.json()) as { pairings?: BrowserSmokePairing[] };
    lastObservedSummary = JSON.stringify(
      (body.pairings ?? []).map((pairing) => ({
        mode: pairing.node?.metadata?.mode ?? null,
        status: pairing.status,
        trust_level: pairing.trust_level ?? null,
      })),
    );
    const approvedPairing = body.pairings?.find((pairing) => {
      return pairing.node?.metadata?.mode === "browser-node" && pairing.status === "approved";
    });
    if (approvedPairing) {
      return approvedPairing;
    }

    await new Promise((done) => setTimeout(done, 250));
  }

  throw new Error(`browser node pairing was not auto-approved; observed=${lastObservedSummary}`);
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
    assertPlaywrightAvailable();

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
    registerBrowserDiagnostics({
      consoleErrors,
      httpErrors,
      page,
      pageErrors,
      requestFailures,
    });

    const targetUrl = `${gateway.baseUrl}/ui?token=${encodeURIComponent(gateway.adminToken)}`;

    try {
      async function ensureOperatorShellVisible(): Promise<void> {
        const deadline = Date.now() + 30_000;
        while (Date.now() <= deadline) {
          const visibleUiState = await Promise.race([
            page!
              .waitForSelector('[data-testid="nav-chat"]', {
                state: "visible",
                timeout: 1_000,
              })
              .then(() => "shell" as const),
            page!
              .waitForSelector('[data-testid="first-run-onboarding"]', {
                state: "visible",
                timeout: 1_000,
              })
              .then(() => "onboarding" as const),
          ]).catch(() => null);

          if (visibleUiState === "shell") {
            return;
          }

          if (visibleUiState === "onboarding") {
            await page!.getByRole("button", { name: "Skip" }).click();
            continue;
          }
        }

        throw new Error("operator shell did not become visible");
      }

      async function authorizeAdminAccess(): Promise<void> {
        const trigger = page!.getByRole("button", { name: "Authorize admin access" }).first();
        await trigger.click();
        await page!.waitForSelector('[data-testid="elevated-mode-dialog"]', {
          state: "visible",
          timeout: 10_000,
        });
        await page!.getByTestId("elevated-mode-confirm").check();
        await page!.getByTestId("elevated-mode-submit").click();
        await page!.waitForSelector('[data-testid="elevated-mode-dialog"]', {
          state: "hidden",
          timeout: 10_000,
        });
      }

      const res = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      if (res && res.status() >= 400) {
        throw new Error(`navigation failed: HTTP ${String(res.status())} ${targetUrl}`);
      }

      await ensureOperatorShellVisible();

      await page.waitForFunction(
        () => !new URL(window.location.href).searchParams.has("token"),
        undefined,
        { timeout: 10_000 },
      );

      await ensureOperatorShellVisible();

      const finalUrl = new URL(page.url());
      expect(finalUrl.pathname === "/ui" || finalUrl.pathname.startsWith("/ui/")).toBe(true);
      expect(finalUrl.searchParams.has("token")).toBe(false);

      await page.getByTestId("nav-chat").click();
      await page.waitForSelector('[data-testid="chat-empty-threads-new"]', {
        state: "visible",
        timeout: 10_000,
      });

      await page.getByTestId("nav-desktop-environments").click();
      await page.waitForSelector('[data-testid="admin-access-gate"]', {
        state: "visible",
        timeout: 10_000,
      });
      await authorizeAdminAccess();
      await page.waitForSelector("text=Desktop Environments", {
        state: "visible",
        timeout: 10_000,
      });
      await page.waitForFunction(
        () =>
          !document.body.textContent?.includes("route is not scope-authorized for scoped tokens"),
        undefined,
        { timeout: 10_000 },
      );

      await page.getByTestId("nav-memory").click();
      await page.waitForSelector('[data-testid="memory-page"]', {
        state: "visible",
        timeout: 10_000,
      });
      await page.waitForFunction(
        () => {
          const text = document.body.textContent ?? "";
          return (
            text.includes("Agent Memory") &&
            !text.includes("Failed to load memory") &&
            !text.includes("route is not scope-authorized for scoped tokens")
          );
        },
        undefined,
        { timeout: 10_000 },
      );

      await page.getByTestId("nav-configure").click();
      await page.waitForSelector('[data-testid="admin-http-tab-policy"]', {
        state: "visible",
        timeout: 10_000,
      });
      await page.getByTestId("admin-http-tab-policy").click();
      await page.waitForSelector('[data-testid="admin-http-policy"]', {
        state: "visible",
        timeout: 10_000,
      });
      expect(await page.locator("body").textContent()).not.toContain(
        "route is not scope-authorized for scoped tokens",
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForSelector('[data-testid="configure-section-select"]', {
        state: "visible",
        timeout: 10_000,
      });
      await page.selectOption('[data-testid="configure-section-select"]', "tools");
      await page.waitForFunction(
        () => document.body.textContent?.includes("Filter tools") ?? false,
        undefined,
        { timeout: 10_000 },
      );
      const horizontalOverflow = await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      );
      expect(horizontalOverflow).toBeLessThanOrEqual(1);
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

  it(
    "auto-approves an already-enabled browser node during onboarding after connect-page login",
    { timeout: 60_000 },
    async () => {
      assertPlaywrightAvailable();

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
      await context.addInitScript(() => {
        localStorage.setItem("tyrum.operator-ui.browserNode.enabled", "1");
      });
      page = await context.newPage();
      registerBrowserDiagnostics({
        consoleErrors,
        httpErrors,
        page,
        pageErrors,
        requestFailures,
      });

      try {
        const res = await page.goto(`${gateway.baseUrl}/ui`, { waitUntil: "domcontentloaded" });
        if (res && res.status() >= 400) {
          throw new Error(`navigation failed: HTTP ${String(res.status())} ${gateway.baseUrl}/ui`);
        }

        await page.getByTestId("login-token").fill(gateway.adminToken);
        await page.getByRole("button", { name: "Connect" }).click();
        await page.waitForSelector('[data-testid="first-run-onboarding"]', {
          state: "visible",
          timeout: 30_000,
        });

        const pairing = await waitForApprovedBrowserNodePairing({
          baseUrl: gateway.baseUrl,
          token: gateway.adminToken,
        });
        expect(pairing.status).toBe("approved");
        expect(pairing.trust_level).toBe("local");
        expect(pairing.node?.metadata?.mode).toBe("browser-node");
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
    },
  );
});
