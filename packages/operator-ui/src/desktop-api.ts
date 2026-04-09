type DesktopMacPermission = "accessibility" | "screenRecording";

export type DesktopBackgroundState = {
  enabled: boolean;
  supported: boolean;
  trayAvailable: boolean;
  loginAutoStartActive: boolean;
  mode: "embedded" | "remote";
};

export type DesktopTailscaleServeStatus = {
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
};

export type DesktopApi = {
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<unknown>;
  background?: {
    getState: () => Promise<DesktopBackgroundState>;
    setEnabled: (enabled: boolean) => Promise<DesktopBackgroundState>;
  };
  gateway: {
    getStatus: () => Promise<{ status: string; port: number }>;
    start: () => Promise<{ status: string; port: number }>;
    stop: () => Promise<{ status: string }>;
    getTailscaleServeStatus?: () => Promise<DesktopTailscaleServeStatus>;
    enableTailscaleServe?: () => Promise<DesktopTailscaleServeStatus>;
    disableTailscaleServe?: () => Promise<DesktopTailscaleServeStatus>;
    getOperatorConnection?: () => Promise<{
      mode: "embedded" | "remote";
      wsUrl: string;
      httpBaseUrl: string;
      token: string;
      tlsCertFingerprint256: string;
    }>;
    httpFetch?: (input: {
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
  openExternal?: (url: string) => Promise<unknown>;
  node: {
    connect: () => Promise<{ status: string }>;
    disconnect: () => Promise<{ status: string }>;
    getStatus?: () => Promise<{ status: string; connected: boolean; deviceId: string | null }>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  onNavigationRequest?: (cb: (request: unknown) => void) => () => void;
  onLog?: (cb: (entry: unknown) => void) => () => void;
  checkMacPermissions?: () => Promise<unknown>;
  requestMacPermission?: (permission: DesktopMacPermission) => Promise<unknown>;
  updates?: {
    getState: () => Promise<unknown>;
    check: () => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<unknown>;
    openReleaseFile: () => Promise<unknown>;
  };
  onUpdateStateChange?: (cb: (state: unknown) => void) => () => void;
};
