import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTyrumHttpClient } from "@tyrum/transport-sdk";
import { formatOperatorUiSmokeDiagnostics } from "../helpers/operator-ui-smoke-diagnostics.js";
import { hasCompleteOperatorUiSnapshot } from "../helpers/operator-ui-build-snapshot.js";
import { startSmokeGateway } from "../e2e/smoke-turn-harness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const OPERATOR_UI_DIST_DIR = resolve(REPO_ROOT, "apps/web/dist");
const OPERATOR_UI_DIST_INDEX = resolve(OPERATOR_UI_DIST_DIR, "index.html");

const OPERATOR_UI_DIR_ENV = "TYRUM_OPERATOR_UI_ASSETS_DIR";
const SNAPSHOT_COPY_RETRY_LIMIT = 20;
const SNAPSHOT_COPY_RETRY_MS = 100;

const LOCATION_FIXTURE = {
  latitude: 52.3676,
  longitude: 4.9041,
};

const isCi = Boolean(process.env.CI?.trim());

async function waitForBuiltOperatorUi(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await hasCompleteOperatorUiSnapshot(OPERATOR_UI_DIST_DIR)) {
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
      if (!(await hasCompleteOperatorUiSnapshot(snapshotDir))) {
        throw new Error("operator UI snapshot copied before the build finished writing assets");
      }
      return snapshotDir;
    } catch (error) {
      await rm(snapshotDir, { recursive: true, force: true });
      if (
        (!isMissingPathError(error) &&
          !(error instanceof Error && error.message.includes("build finished writing assets"))) ||
        attempt >= SNAPSHOT_COPY_RETRY_LIMIT
      ) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, SNAPSHOT_COPY_RETRY_MS));
    }
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

async function assertBrowserGeolocationReady(
  page: (typeof import("playwright"))["Page"],
): Promise<void> {
  const result = await page.evaluate(async () => {
    const api = globalThis.navigator?.geolocation;
    if (!globalThis.isSecureContext || !api) {
      return {
        ok: false as const,
        error: `secure=${String(globalThis.isSecureContext)} geolocation=${String(Boolean(api))}`,
      };
    }

    return await new Promise<
      { ok: true; latitude: number; longitude: number } | { ok: false; error: string }
    >((settle) => {
      api.getCurrentPosition(
        (position) =>
          settle({
            ok: true,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        (error) => settle({ ok: false, error: error.message }),
        {
          enableHighAccuracy: true,
          timeout: 5_000,
          maximumAge: 0,
        },
      );
    });
  });

  if (!result.ok) {
    throw new Error(`browser geolocation preflight failed: ${result.error}`);
  }
}

async function waitForApprovedBrowserNodePairing(input: {
  baseUrl: string;
  tlsFingerprint256: string;
  token: string;
  timeoutMs?: number;
}): Promise<string> {
  const client = createTyrumHttpClient({
    baseUrl: input.baseUrl,
    auth: { type: "bearer", token: input.token },
    tlsCertFingerprint256: input.tlsFingerprint256,
    tlsAllowSelfSigned: true,
  });
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let lastObservedSummary = "none";

  while (Date.now() <= deadline) {
    const listed = await client.pairings.list({});
    lastObservedSummary = JSON.stringify(
      listed.pairings.map((pairing) => ({
        node_id: pairing.node.node_id,
        mode: pairing.node.metadata?.mode ?? null,
        status: pairing.status,
        trust_level: pairing.trust_level ?? null,
      })),
    );
    const approved = listed.pairings.find(
      (pairing) => pairing.node.metadata?.mode === "browser-node" && pairing.status === "approved",
    );
    if (approved) {
      return approved.node.node_id;
    }
    await new Promise((done) => setTimeout(done, 250));
  }

  throw new Error(`browser node pairing was not auto-approved; observed=${lastObservedSummary}`);
}

async function waitForDispatchableLocationNode(input: {
  baseUrl: string;
  nodeId: string;
  tlsFingerprint256: string;
  token: string;
  timeoutMs?: number;
}): Promise<void> {
  const client = createTyrumHttpClient({
    baseUrl: input.baseUrl,
    auth: { type: "bearer", token: input.token },
    tlsCertFingerprint256: input.tlsFingerprint256,
    tlsAllowSelfSigned: true,
  });
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let lastObservedSummary = "none";

  while (Date.now() <= deadline) {
    const listed = await client.nodes.list({
      capability: "tyrum.location.get",
      dispatchable_only: true,
    });
    lastObservedSummary = JSON.stringify(
      listed.nodes.map((node) => ({
        node_id: node.node_id,
        connected: node.connected,
        paired_status: node.paired_status,
        capabilities: node.capabilities.map((capability) => ({
          capability: capability.capability,
          ready: capability.ready,
          dispatchable: capability.dispatchable,
          available_action_count: capability.available_action_count,
        })),
      })),
    );

    if (listed.nodes.some((node) => node.node_id === input.nodeId)) {
      return;
    }

    await new Promise((done) => setTimeout(done, 250));
  }

  throw new Error(
    `browser node did not become dispatchable for tyrum.location.get; observed=${lastObservedSummary}`,
  );
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

describe.skipIf(!canRunPlaywright && !isCi)("operator UI HTTPS browser-node smoke", () => {
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

  it(
    "pairs a browser node over self-signed HTTPS and dispatches tyrum.location.get",
    { timeout: 90_000 },
    async () => {
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

      const gateway = await startSmokeGateway({ tlsSelfSigned: true });
      stopGateway = gateway.stop;
      if (!gateway.tlsFingerprint256) {
        throw new Error("expected self-signed smoke gateway to expose a TLS fingerprint");
      }

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      const httpErrors: string[] = [];

      const pw = await import("playwright");
      browser = await pw.chromium.launch({ headless: true });
      context = await browser.newContext({
        geolocation: LOCATION_FIXTURE,
        ignoreHTTPSErrors: true,
      });
      await context.addInitScript(() => {
        localStorage.setItem("tyrum.operator-ui.browserNode.enabled", "1");
        localStorage.setItem("tyrum.operator-ui.browserNode.autoConsent", "1");
      });
      await context.grantPermissions(["geolocation"], { origin: gateway.baseUrl });
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
        await assertBrowserGeolocationReady(page);
        await page.getByTestId("login-token").fill(gateway.adminToken);
        await page.getByRole("button", { name: "Connect" }).click();
        await Promise.race([
          page.waitForSelector('[data-testid="first-run-onboarding"]', {
            state: "visible",
            timeout: 30_000,
          }),
          page.waitForSelector('[data-testid="nav-chat"]', {
            state: "visible",
            timeout: 30_000,
          }),
        ]);

        const approvedNodeId = await waitForApprovedBrowserNodePairing({
          baseUrl: gateway.baseUrl,
          tlsFingerprint256: gateway.tlsFingerprint256,
          token: gateway.adminToken,
        });
        expect(approvedNodeId.length).toBeGreaterThan(0);
        await waitForDispatchableLocationNode({
          baseUrl: gateway.baseUrl,
          nodeId: approvedNodeId,
          tlsFingerprint256: gateway.tlsFingerprint256,
          token: gateway.adminToken,
        });

        const httpClient = createTyrumHttpClient({
          baseUrl: gateway.baseUrl,
          auth: { type: "bearer", token: gateway.adminToken },
          tlsCertFingerprint256: gateway.tlsFingerprint256,
          tlsAllowSelfSigned: true,
        });
        const dispatchResult = await httpClient.nodes.dispatch(
          approvedNodeId,
          "tyrum.location.get",
          "get",
          {
            input: {
              enable_high_accuracy: true,
              timeout_ms: 30_000,
              maximum_age_ms: 0,
            },
          },
        );

        if (!dispatchResult.ok) {
          throw new Error(`location dispatch failed: ${JSON.stringify(dispatchResult)}`);
        }
        expect(dispatchResult.ok).toBe(true);
        expect(dispatchResult.error).toBeNull();
        expect(dispatchResult.payload_source).toBe("evidence");
        expect(dispatchResult.payload).toMatchObject({
          op: "get",
          coords: {
            latitude: LOCATION_FIXTURE.latitude,
            longitude: LOCATION_FIXTURE.longitude,
          },
        });
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
