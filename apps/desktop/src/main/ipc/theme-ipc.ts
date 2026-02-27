import { ipcMain, nativeTheme, type BrowserWindow } from "electron";
import { createWindowSender } from "./window-sender.js";
import type { DesktopThemeState } from "../../shared/theme.js";

const sender = createWindowSender();

export type { DesktopThemeState };

let ipcRegistered = false;

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
  nativeTheme.themeSource = "system";

  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle("theme:get-state", () => getThemeState());

  nativeTheme.on("updated", () => {
    sender.send("theme:state", getThemeState());
  });
}
