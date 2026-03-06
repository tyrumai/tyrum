import { ipcMain } from "electron";
import { getBackgroundModeController } from "../background-mode.js";

let ipcRegistered = false;

export function registerBackgroundIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("background:get-state", () => {
    const controller = getBackgroundModeController();
    if (!controller) {
      throw new Error("Background mode controller is not initialized");
    }
    return controller.getState();
  });

  ipcMain.handle("background:set-enabled", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") {
      throw new Error("background:set-enabled requires a boolean");
    }

    const controller = getBackgroundModeController();
    if (!controller) {
      throw new Error("Background mode controller is not initialized");
    }

    return controller.setEnabled(enabled);
  });
}
