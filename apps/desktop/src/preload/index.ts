import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tyrumDesktop", {
  getStartupState: () => ipcRenderer.invoke("app:get-startup-state"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (partial: unknown) => ipcRenderer.invoke("config:set", partial),
  gateway: {
    start: () => ipcRenderer.invoke("gateway:start"),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    getStatus: () => ipcRenderer.invoke("gateway:status"),
    getUiUrls: (options?: { startOnboarding?: boolean }) =>
      ipcRenderer.invoke("gateway:ui-urls", options),
  },
  node: {
    connect: () => ipcRenderer.invoke("node:connect"),
    disconnect: () => ipcRenderer.invoke("node:disconnect"),
  },
  onboarding: {
    selectMode: (mode: "embedded" | "remote") =>
      ipcRenderer.invoke("onboarding:select-mode", mode),
  },
  onStatusChange: (cb: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => cb(status);
    ipcRenderer.on("status:change", listener);
    return () => {
      ipcRenderer.removeListener("status:change", listener);
    };
  },
  onLog: (cb: (entry: unknown) => void) => {
    const listener = (_event: unknown, entry: unknown) => cb(entry);
    ipcRenderer.on("log:entry", listener);
    return () => {
      ipcRenderer.removeListener("log:entry", listener);
    };
  },
  onConsentRequest: (cb: (req: unknown) => void) => {
    const listener = (_event: unknown, req: unknown) => cb(req);
    ipcRenderer.on("consent:request", listener);
    return () => {
      ipcRenderer.removeListener("consent:request", listener);
    };
  },
  consentRespond: (planId: string, approved: boolean, reason?: string) =>
    ipcRenderer.invoke("consent:respond", planId, approved, reason),
  checkMacPermissions: () => ipcRenderer.invoke("permissions:check-mac"),
  requestMacPermission: (permission: "accessibility" | "screenRecording") =>
    ipcRenderer.invoke("permissions:request-mac", permission),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
});
