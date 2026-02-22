import { ipcMain, type BrowserWindow } from "electron";
import { NodeRuntime } from "../node-runtime.js";
import { loadConfig } from "../config/store.js";
import { resolvePermissions } from "../config/permissions.js";
import { decryptToken } from "../config/token-store.js";
import { createHash } from "node:crypto";
import { DesktopProvider } from "../providers/desktop-provider.js";
import { PlaywrightProvider } from "../providers/playwright-provider.js";
import { CliProvider } from "../providers/cli-provider.js";
import { NutJsDesktopBackend } from "../providers/backends/nutjs-desktop-backend.js";
import { RealPlaywrightBackend } from "../providers/backends/real-playwright-backend.js";
import { createWindowSender } from "./window-sender.js";
import {
  ensureEmbeddedGatewayToken,
  startEmbeddedGatewayFromConfig,
} from "./gateway-ipc.js";

const sender = createWindowSender();

let runtime: NodeRuntime | null = null;
let playwrightBackend: RealPlaywrightBackend | null = null;
let ipcRegistered = false;

function deriveNodeEnrollmentToken(adminToken: string): string {
  return createHash("sha256")
    .update(`tyrum-node-enrollment-v1|${adminToken}`, "utf-8")
    .digest("hex");
}

function toNodeStatusString(status: { connected: boolean; code?: number }): string {
  if (status.connected) return "connected";
  if (status.code != null && status.code !== 1000) return "error";
  return "disconnected";
}

async function cleanupNodeResources(): Promise<void> {
  runtime?.disconnect();
  runtime = null;
  if (playwrightBackend) {
    await playwrightBackend.close();
    playwrightBackend = null;
  }
}

export async function shutdownNodeResources(): Promise<void> {
  await cleanupNodeResources();
}

export function registerNodeIpc(window: BrowserWindow): void {
  sender.setWindow(window);
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("node:connect", async () => {
    // Clean up any prior runtime/backends (e.g., if user clicks connect twice).
    await cleanupNodeResources();

    let config = loadConfig();
    const permissions = resolvePermissions(
      config.permissions.profile,
      config.permissions.overrides,
    );

    let wsUrl = "";
    let token = "";
    let fallbackToken: string | null = null;
    let attemptedFallback = false;

    runtime = new NodeRuntime(config, permissions, {
      onStatusChange: (status) => {
        if (
          !status.connected &&
          !attemptedFallback &&
          fallbackToken &&
          status.code === 4001 &&
          status.reason === "unauthorized"
        ) {
          attemptedFallback = true;
          runtime?.connect(wsUrl, fallbackToken);
        }
        sender.send("status:change", {
          nodeStatus: toNodeStatusString(status),
          node: status,
        });
      },
      onConsentRequest: (msg) => sender.send("consent:request", msg),
      onPlanUpdate: (msg) => sender.send("plan:update", msg),
      onLog: (entry) => sender.send("log:entry", { source: "node", ...entry }),
    });

    // Determine WS URL and token based on mode
    if (config.mode === "embedded") {
      await startEmbeddedGatewayFromConfig();
      config = loadConfig();
      wsUrl = `ws://127.0.0.1:${config.embedded.port}/ws`;
      token = deriveNodeEnrollmentToken(ensureEmbeddedGatewayToken(config));
    } else {
      wsUrl = config.remote.wsUrl;
      const rawToken = config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "";
      // Prefer the derived node enrollment token (works when the config stores the admin token),
      // but fall back to the raw token when the gateway expects a custom enrollment token or
      // when the config already stores a node-scoped token.
      token = rawToken ? deriveNodeEnrollmentToken(rawToken) : "";
      fallbackToken = rawToken || null;
    }

    // Register providers based on capabilities and permissions
    if (config.capabilities.desktop) {
      const desktopBackend = new NutJsDesktopBackend();
      runtime.registerProvider(
        new DesktopProvider(desktopBackend, permissions, async (_prompt) => {
          // For V1: fail-closed - always require explicit approval through UI
          return false;
        }),
      );
    }
    if (config.capabilities.playwright && permissions.playwright) {
      playwrightBackend = new RealPlaywrightBackend({
        headless: config.web.headless,
      });
      runtime.registerProvider(
        new PlaywrightProvider(
          {
            allowedDomains: config.web.allowedDomains,
            headless: config.web.headless,
            domainRestricted: permissions.playwrightDomainRestricted,
          },
          playwrightBackend,
        ),
      );
    }
    if (config.capabilities.cli && permissions.cli) {
      runtime.registerProvider(
        new CliProvider(
          config.cli.allowedCommands,
          config.cli.allowedWorkingDirs,
          permissions.cliAllowlistEnforced,
        ),
      );
    }

    runtime.connect(wsUrl, token);
    return { status: "connecting" };
  });

  ipcMain.handle("node:disconnect", async () => {
    await cleanupNodeResources();
    sender.send("status:change", { nodeStatus: "disconnected" });
    return { status: "disconnected" };
  });

  ipcMain.handle(
    "consent:respond",
    (_event, requestId: string, approved: boolean, reason?: string) => {
      runtime?.respondToConsent(requestId, approved, reason);
      return { status: "responded" };
    },
  );
}
