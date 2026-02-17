import { ipcMain } from "electron";
import { loadConfig, saveConfig } from "../config/store.js";
import { DesktopNodeConfig } from "../config/schema.js";
import { checkMacPermissions } from "../platform/permissions.js";

export function registerConfigIpc(): void {
  ipcMain.handle("config:get", () => {
    return loadConfig();
  });

  ipcMain.handle("config:set", (_event, partial: unknown) => {
    const current = loadConfig();
    const merged = DesktopNodeConfig.parse({ ...current, ...(partial as Record<string, unknown>) });
    saveConfig(merged);
    return merged;
  });

  ipcMain.handle("permissions:check-mac", () => {
    return checkMacPermissions();
  });
}
