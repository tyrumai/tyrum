import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tyrumDesktop", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (partial: unknown) => ipcRenderer.invoke("config:set", partial),
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
  consentRespond: (requestId: string, approved: boolean, reason?: string) =>
    ipcRenderer.invoke("consent:respond", requestId, approved, reason),
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
});
