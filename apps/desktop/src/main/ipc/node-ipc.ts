import { ipcMain, type BrowserWindow } from "electron";
import { NodeRuntime } from "../node-runtime.js";
import { loadConfig } from "../config/store.js";
import { resolvePermissions } from "../config/permissions.js";
import { decryptToken } from "../config/token-store.js";
import { DesktopProvider } from "../providers/desktop-provider.js";
import { getTesseractOcrEngine } from "../providers/ocr/tesseract-engine.js";
import { PlaywrightProvider } from "../providers/playwright-provider.js";
import { CliProvider } from "../providers/cli-provider.js";
import { NutJsDesktopBackend } from "../providers/backends/nutjs-desktop-backend.js";
import { RealPlaywrightBackend } from "../providers/backends/real-playwright-backend.js";
import { createWindowSender } from "./window-sender.js";
import { ensureEmbeddedGatewayToken, startEmbeddedGatewayFromConfig } from "./gateway-ipc.js";

const sender = createWindowSender();

let runtime: NodeRuntime | null = null;
let playwrightBackend: RealPlaywrightBackend | null = null;
let ipcRegistered = false;

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

    runtime = new NodeRuntime(config, permissions, {
      onStatusChange: (status) =>
        sender.send("status:change", {
          nodeStatus: toNodeStatusString(status),
          node: status,
        }),
      onConsentRequest: (msg) => sender.send("consent:request", msg),
      onPlanUpdate: (msg) => sender.send("plan:update", msg),
      onLog: (entry) => sender.send("log:entry", { source: "node", ...entry }),
    });

    // Determine WS URL and token based on mode
    let wsUrl: string;
    let token: string;
    if (config.mode === "embedded") {
      await startEmbeddedGatewayFromConfig();
      config = loadConfig();
      wsUrl = `ws://127.0.0.1:${config.embedded.port}/ws`;
      token = ensureEmbeddedGatewayToken(config);
    } else {
      wsUrl = config.remote.wsUrl;
      token = config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "";
    }

    // Register providers based on capabilities and permissions
    if (config.capabilities.desktop) {
      const desktopBackend = new NutJsDesktopBackend();
      runtime.registerProvider(
        new DesktopProvider(
          desktopBackend,
          permissions,
          async (_prompt) => {
            // For V1: fail-closed - always require explicit approval through UI
            return false;
          },
          getTesseractOcrEngine(),
        ),
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
