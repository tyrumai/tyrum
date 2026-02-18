import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export const MAIN_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 860,
  minWidth: 1100,
  minHeight: 760,
  webPreferences: {
    preload: join(import.meta.dirname, "../preload/index.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
  },
};
