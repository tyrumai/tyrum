import type { BrowserWindow } from "electron";

export interface WindowSender {
  setWindow: (window: BrowserWindow | null) => void;
  send: (channel: string, payload: unknown) => void;
}

export function createWindowSender(): WindowSender {
  let currentWindow: BrowserWindow | null = null;

  function setWindow(window: BrowserWindow | null): void {
    currentWindow = window;
  }

  function send(channel: string, payload: unknown): void {
    const win = currentWindow;
    if (!win) return;
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      currentWindow = null;
      return;
    }
    win.webContents.send(channel, payload);
  }

  return { setWindow, send };
}

