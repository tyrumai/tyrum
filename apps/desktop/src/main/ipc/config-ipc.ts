import { ipcMain } from "electron";
import { loadConfig, saveConfig } from "../config/store.js";
import { DesktopNodeConfig } from "../config/schema.js";
import { checkMacPermissions } from "../platform/permissions.js";

/** Recursively merge `source` into `target`, preserving nested fields. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const src = source[key];
    const tgt = result[key];
    if (
      src !== null &&
      typeof src === "object" &&
      !Array.isArray(src) &&
      tgt !== null &&
      typeof tgt === "object" &&
      !Array.isArray(tgt)
    ) {
      result[key] = deepMerge(
        tgt as Record<string, unknown>,
        src as Record<string, unknown>,
      );
    } else {
      result[key] = src;
    }
  }
  return result;
}

export function registerConfigIpc(): void {
  ipcMain.handle("config:get", () => {
    return loadConfig();
  });

  ipcMain.handle("config:set", (_event, partial: unknown) => {
    const current = loadConfig();
    const merged = DesktopNodeConfig.parse(
      deepMerge(
        current as unknown as Record<string, unknown>,
        partial as Record<string, unknown>,
      ),
    );
    saveConfig(merged);
    return merged;
  });

  ipcMain.handle("permissions:check-mac", () => {
    return checkMacPermissions();
  });
}
