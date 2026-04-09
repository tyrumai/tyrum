import type { DesktopThemeState } from "../shared/theme.js";

export type { DesktopThemeState };

export interface DesktopBackgroundState {
  enabled: boolean;
  supported: boolean;
  trayAvailable: boolean;
  loginAutoStartActive: boolean;
  mode: "embedded" | "remote";
}

export interface TailscaleServeStatusInfo {
  adminUrl: string;
  binaryAvailable: boolean;
  backendRunning: boolean;
  backendState: string;
  currentPublicBaseUrl: string;
  dnsName: string | null;
  gatewayReachable: boolean;
  gatewayReachabilityReason: string | null;
  gatewayTarget: string;
  managedStatePresent: boolean;
  ownership: "disabled" | "managed" | "unmanaged" | "conflict";
  publicBaseUrlMatches: boolean | null;
  publicUrl: string | null;
  reason: string | null;
}

export interface TyrumDesktopApi {
  configExists: () => Promise<boolean>;
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<void>;
  background: {
    getState: () => Promise<DesktopBackgroundState>;
    setEnabled: (enabled: boolean) => Promise<DesktopBackgroundState>;
  };
  theme: {
    getState: () => Promise<DesktopThemeState>;
    onChange: (cb: (state: DesktopThemeState) => void) => () => void;
  };
  updates: {
    getState: () => Promise<unknown>;
    check: () => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<unknown>;
    openReleaseFile: () => Promise<unknown>;
  };
  gateway: {
    start: () => Promise<{ status: string; port: number }>;
    stop: () => Promise<{ status: string }>;
    getStatus: () => Promise<{ status: string; port: number }>;
    getTailscaleServeStatus: () => Promise<TailscaleServeStatusInfo>;
    enableTailscaleServe: () => Promise<TailscaleServeStatusInfo>;
    disableTailscaleServe: () => Promise<TailscaleServeStatusInfo>;
    getOperatorConnection: () => Promise<{
      mode: "embedded" | "remote";
      wsUrl: string;
      httpBaseUrl: string;
      token: string;
      tlsCertFingerprint256: string;
    }>;
    httpFetch: (input: {
      url: string;
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
    }) => Promise<{
      status: number;
      headers: Record<string, string>;
      bodyText: string;
    }>;
  };
  node: {
    connect: () => Promise<{ status: string }>;
    disconnect: () => Promise<{ status: string }>;
    getStatus: () => Promise<{ status: string; connected: boolean; deviceId: string | null }>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  onLog: (cb: (entry: unknown) => void) => () => void;
  checkMacPermissions: () => Promise<unknown>;
  requestMacPermission: (permission: "accessibility" | "screenRecording") => Promise<unknown>;
  openExternal: (url: string) => Promise<void>;
  onUpdateStateChange: (cb: (state: unknown) => void) => () => void;
  onNavigationRequest: (cb: (req: unknown) => void) => () => void;
  consumeDeepLink: () => Promise<string | null>;
  onDeepLinkOpen: (cb: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    tyrumDesktop: TyrumDesktopApi;
  }
}
