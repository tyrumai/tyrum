import { ipcMain, nativeTheme, type BrowserWindow } from "electron";
import { createWindowSender } from "./window-sender.js";

const sender = createWindowSender();

export interface DesktopThemeState {
  colorScheme: "light" | "dark";
  highContrast: boolean;
  inverted: boolean;
  source: "system" | "light" | "dark";
}

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
