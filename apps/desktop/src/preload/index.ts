import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tyrumDesktop", {
  configExists: () => ipcRenderer.invoke("config:exists"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (partial: unknown) => ipcRenderer.invoke("config:set", partial),
  background: {
    getState: () => ipcRenderer.invoke("background:get-state"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("background:set-enabled", enabled),
  },
  theme: {
    getState: () => ipcRenderer.invoke("theme:get-state"),
    onChange: (cb: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => cb(state);
      ipcRenderer.on("theme:state", listener);
      return () => {
        ipcRenderer.removeListener("theme:state", listener);
      };
    },
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    openReleaseFile: () => ipcRenderer.invoke("updates:open-release-file"),
  },
  gateway: {
    start: () => ipcRenderer.invoke("gateway:start"),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    getStatus: () => ipcRenderer.invoke("gateway:status"),
    getOperatorConnection: () => ipcRenderer.invoke("gateway:operator-connection"),
    httpFetch: (input: {
      url: string;
      init?: { method?: string; headers?: Record<string, string>; body?: string };
    }) => ipcRenderer.invoke("gateway:http-fetch", input),
  },
  node: {
    connect: () => ipcRenderer.invoke("node:connect"),
    disconnect: () => ipcRenderer.invoke("node:disconnect"),
    getStatus: () => ipcRenderer.invoke("node:get-status"),
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
  checkMacPermissions: () => ipcRenderer.invoke("permissions:check-mac"),
  requestMacPermission: (permission: "accessibility" | "screenRecording") =>
    ipcRenderer.invoke("permissions:request-mac", permission),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  onUpdateStateChange: (cb: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => cb(state);
    ipcRenderer.on("update:state", listener);
    return () => {
      ipcRenderer.removeListener("update:state", listener);
    };
  },
  onNavigationRequest: (cb: (req: unknown) => void) => {
    const listener = (_event: unknown, req: unknown) => cb(req);
    ipcRenderer.on("navigation:request", listener);
    return () => {
      ipcRenderer.removeListener("navigation:request", listener);
    };
  },
  consumeDeepLink: () => ipcRenderer.invoke("deeplink:consume"),
  onDeepLinkOpen: (cb: (url: string) => void) => {
    const listener = (_event: unknown, url: unknown) => {
      if (typeof url !== "string") {
        return;
      }
      cb(url);
    };
    ipcRenderer.on("deeplink:open", listener);
    return () => {
      ipcRenderer.removeListener("deeplink:open", listener);
    };
  },
});
