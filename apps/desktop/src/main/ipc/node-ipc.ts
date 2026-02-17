import { ipcMain, type BrowserWindow } from "electron";
import { NodeRuntime } from "../node-runtime.js";
import { loadConfig } from "../config/store.js";
import { resolvePermissions } from "../config/permissions.js";
import { decryptToken } from "../config/token-store.js";

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

    // Register providers here in future tasks (5.2, 5.3, 5.4)

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
