import type { DesktopThemeState } from "../shared/theme.js";

export type { DesktopThemeState };

export interface DesktopBackgroundState {
  enabled: boolean;
  supported: boolean;
  trayAvailable: boolean;
  loginAutoStartActive: boolean;
  mode: "embedded" | "remote";
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
    getOperatorConnection: () => Promise<{
      mode: "embedded" | "remote";
      wsUrl: string;
      httpBaseUrl: string;
      token: string;
      tlsCertFingerprint256: string;
      tlsAllowSelfSigned: boolean;
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
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  onLog: (cb: (entry: unknown) => void) => () => void;
  onConsentRequest: (cb: (req: unknown) => void) => () => void;
  consentRespond: (planId: string, approved: boolean, reason?: string) => Promise<void>;
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
