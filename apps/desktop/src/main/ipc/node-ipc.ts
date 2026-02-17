import { ipcMain, type BrowserWindow } from "electron";
import { NodeRuntime } from "../node-runtime.js";
import { loadConfig } from "../config/store.js";
import { resolvePermissions } from "../config/permissions.js";
import { decryptToken } from "../config/token-store.js";
import { DesktopProvider } from "../providers/desktop-provider.js";
import { PlaywrightProvider } from "../providers/playwright-provider.js";
import { CliProvider } from "../providers/cli-provider.js";
// TODO(#21): replace MockDesktopBackend with real NutJsDesktopBackend
import { MockDesktopBackend } from "../providers/backends/desktop-backend.js";
// TODO(#22): replace MockPlaywrightBackend with real PlaywrightBackendImpl
import { MockPlaywrightBackend } from "../providers/backends/playwright-backend.js";

let runtime: NodeRuntime | null = null;

export function registerNodeIpc(window: BrowserWindow): void {
  ipcMain.handle("node:connect", async () => {
    const config = loadConfig();
    const permissions = resolvePermissions(
      config.permissions.profile,
      config.permissions.overrides,
    );

    runtime = new NodeRuntime(config, permissions, {
      onStatusChange: (status) => window.webContents.send("status:change", { node: status }),
      onConsentRequest: (msg) => window.webContents.send("consent:request", msg),
      onPlanUpdate: (msg) => window.webContents.send("plan:update", msg),
      onLog: (entry) => window.webContents.send("log:entry", { source: "node", ...entry }),
    });

    // Determine WS URL and token based on mode
    let wsUrl: string;
    let token: string;
    if (config.mode === "embedded") {
      wsUrl = `ws://127.0.0.1:${config.embedded.port}/ws`;
      token = config.embedded.tokenRef ? decryptToken(config.embedded.tokenRef) : "";
    } else {
      wsUrl = config.remote.wsUrl;
      token = config.remote.tokenRef ? decryptToken(config.remote.tokenRef) : "";
    }

    // Register providers based on capabilities and permissions
    if (config.capabilities.desktop) {
      // TODO(#21): replace with real backend once nut-js integration is ready
      const desktopBackend = new MockDesktopBackend();
      runtime.registerProvider(new DesktopProvider(desktopBackend, permissions, async (_prompt) => {
        // For V1: fail-closed - always require explicit approval through UI
        return false;
      }));
    }
    if (config.capabilities.playwright && permissions.playwright) {
      // TODO(#22): replace with real backend once playwright integration is ready
      const playwrightBackend = new MockPlaywrightBackend();
      runtime.registerProvider(new PlaywrightProvider({
        allowedDomains: config.web.allowedDomains,
        headless: config.web.headless,
        domainRestricted: permissions.playwrightDomainRestricted,
      }, playwrightBackend));
    }
    if (config.capabilities.cli && permissions.cli) {
      runtime.registerProvider(new CliProvider(
        config.cli.allowedCommands,
        config.cli.allowedWorkingDirs,
      ));
    }

    runtime.connect(wsUrl, token);
    return { status: "connecting" };
  });

  ipcMain.handle("node:disconnect", () => {
    runtime?.disconnect();
    runtime = null;
    return { status: "disconnected" };
  });

  ipcMain.handle("consent:respond", (_event, planId: string, approved: boolean, reason?: string) => {
    runtime?.respondToConsent(planId, approved, reason);
    return { status: "responded" };
  });
}
