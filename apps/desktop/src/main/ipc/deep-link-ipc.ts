import { ipcMain } from "electron";

let ipcRegistered = false;
let pendingDeepLinkUrl: string | null = null;

export function setPendingDeepLinkUrl(rawUrl: string): void {
  pendingDeepLinkUrl = rawUrl;
}

function consumePendingDeepLinkUrl(): string | null {
  const url = pendingDeepLinkUrl;
  pendingDeepLinkUrl = null;
  return url;
}

export function registerDeepLinkIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("deeplink:consume", () => {
    return consumePendingDeepLinkUrl();
  });
}
