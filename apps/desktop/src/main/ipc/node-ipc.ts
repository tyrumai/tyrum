import { ipcMain, type BrowserWindow } from "electron";
import { NodeRuntime } from "../node-runtime.js";
import { loadConfig } from "../config/store.js";
import { resolvePermissions } from "../config/permissions.js";
import { decryptToken } from "../config/token-store.js";
import {
  AtSpiDesktopA11yBackend,
  DesktopProvider,
  getTesseractOcrEngine,
  NutJsDesktopBackend,
} from "@tyrum/desktop-node";
import { PlaywrightProvider } from "../providers/playwright-provider.js";
import { CliProvider } from "../providers/cli-provider.js";
import { RealPlaywrightBackend } from "../providers/backends/real-playwright-backend.js";
import { createWindowSender } from "./window-sender.js";
import { ensureEmbeddedGatewayToken, startEmbeddedGatewayFromConfig } from "./gateway-ipc.js";
import type { DesktopNodeConfig } from "../config/schema.js";
import type { ResolvedPermissions } from "../config/permissions.js";

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

function createRuntime(config: DesktopNodeConfig, permissions: ResolvedPermissions): NodeRuntime {
  return new NodeRuntime(config, permissions, {
    onStatusChange: (status) =>
      sender.send("status:change", {
        nodeStatus: toNodeStatusString(status),
        node: status,
      }),
    onConsentRequest: (msg) => sender.send("consent:request", msg),
    onPlanUpdate: (msg) => sender.send("plan:update", msg),
    onLog: (entry) => sender.send("log:entry", { source: "node", ...entry }),
  });
}

async function resolveNodeConnection(
  config: DesktopNodeConfig,
): Promise<{ wsUrl: string; token: string; config: DesktopNodeConfig }> {
  if (config.mode === "embedded") {
    await startEmbeddedGatewayFromConfig();
    const nextConfig = loadConfig();
    return {
      config: nextConfig,
      wsUrl: `ws://127.0.0.1:${nextConfig.embedded.port}/ws`,
      token: ensureEmbeddedGatewayToken(nextConfig),
    };
  }

  return {
    config,
    wsUrl: config.remote.wsUrl,
    token: config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "",
  };
}

function registerProviders(
  nodeRuntime: NodeRuntime,
  config: DesktopNodeConfig,
  permissions: ResolvedPermissions,
): void {
  // Register providers based on capabilities and permissions
  if (config.capabilities.desktop) {
    const desktopBackend = new NutJsDesktopBackend();
    const a11yBackend = process.platform === "linux" ? new AtSpiDesktopA11yBackend() : undefined;
    nodeRuntime.registerProvider(
      new DesktopProvider(
        desktopBackend,
        permissions,
        async (_prompt: string) => {
          // For V1: fail-closed - always require explicit approval through UI
          return false;
        },
        getTesseractOcrEngine(),
        a11yBackend,
      ),
    );
  }
  if (config.capabilities.playwright && permissions.playwright) {
    playwrightBackend = new RealPlaywrightBackend({
      headless: config.web.headless,
    });
    nodeRuntime.registerProvider(
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
    nodeRuntime.registerProvider(
      new CliProvider(
        config.cli.allowedCommands,
        config.cli.allowedWorkingDirs,
        permissions.cliAllowlistEnforced,
      ),
    );
  }
}

async function handleNodeConnect(): Promise<{ status: "connecting" | "disconnected" }> {
  // Clean up any prior runtime/backends (e.g., if user clicks connect twice).
  await cleanupNodeResources();

  const config = loadConfig();
  const permissions = resolvePermissions(config.permissions.profile, config.permissions.overrides);

  const nextRuntime = createRuntime(config, permissions);
  runtime = nextRuntime;

  try {
    const { wsUrl, token, config: effectiveConfig } = await resolveNodeConnection(config);
    if (runtime !== nextRuntime) {
      return { status: "disconnected" };
    }

    registerProviders(nextRuntime, effectiveConfig, permissions);
    nextRuntime.connect(wsUrl, token);

    return { status: "connecting" };
  } catch (error) {
    if (runtime === nextRuntime) {
      await cleanupNodeResources();
    }
    throw error;
  }
}

async function handleNodeDisconnect(): Promise<{ status: "disconnected" }> {
  await cleanupNodeResources();
  sender.send("status:change", { nodeStatus: "disconnected" });
  return { status: "disconnected" };
}

function handleConsentRespond(
  _event: Electron.IpcMainInvokeEvent,
  requestId: string,
  approved: boolean,
  reason?: string,
): { status: "responded" } {
  runtime?.respondToConsent(requestId, approved, reason);
  return { status: "responded" };
}

export function registerNodeIpc(window: BrowserWindow): void {
  sender.setWindow(window);
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("node:connect", handleNodeConnect);
  ipcMain.handle("node:disconnect", handleNodeDisconnect);
  ipcMain.handle("consent:respond", handleConsentRespond);
}
