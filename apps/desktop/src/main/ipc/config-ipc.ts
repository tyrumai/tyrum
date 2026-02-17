import { ipcMain } from "electron";
import { loadConfig, saveConfig } from "../config/store.js";
import { DesktopNodeConfig } from "../config/schema.js";

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
    if (process.platform !== "darwin") return { accessibility: true, screenRecording: true };
    // On macOS, check accessibility and screen recording permissions
    // For V1, return unknown status with instructions
    return {
      accessibility: null, // null = unknown, true = granted, false = denied
      screenRecording: null,
      instructions: "Open System Settings > Privacy & Security to grant permissions",
    };
  });
}
