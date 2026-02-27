import { ipcMain, nativeTheme, type BrowserWindow } from "electron";
import { createWindowSender } from "./window-sender.js";
import type { DesktopThemeState } from "../../shared/theme.js";
import { loadConfig } from "../config/store.js";

const sender = createWindowSender();

export type { DesktopThemeState };

let ipcRegistered = false;

function resolveThemeSource(config: unknown): "system" | "light" | "dark" {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "system";
  }
  const theme = (config as Record<string, unknown>)["theme"];
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
    return "system";
  }
  const source = (theme as Record<string, unknown>)["source"];
  if (source === "system" || source === "light" || source === "dark") {
    return source;
  }
  return "system";
}

function getThemeState(): DesktopThemeState {
  return {
    colorScheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    highContrast: nativeTheme.shouldUseHighContrastColors,
    inverted: nativeTheme.shouldUseInvertedColorScheme,
    source: nativeTheme.themeSource,
  };
}

export function registerThemeIpc(window: BrowserWindow): void {
  sender.setWindow(window);
  nativeTheme.themeSource = resolveThemeSource(loadConfig());

  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle("theme:get-state", () => getThemeState());

  nativeTheme.on("updated", () => {
    sender.send("theme:state", getThemeState());
  });
}
