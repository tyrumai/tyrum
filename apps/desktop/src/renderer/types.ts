export interface TyrumDesktopApi {
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<void>;
  gateway: {
    start: () => Promise<{ status: string; port: number; wsToken: string }>;
    stop: () => Promise<{ status: string }>;
  };
  node: {
    connect: () => Promise<{ status: string }>;
    disconnect: () => Promise<{ status: string }>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  onLog: (cb: (entry: unknown) => void) => () => void;
  onConsentRequest: (cb: (req: unknown) => void) => () => void;
  consentRespond: (
    planId: string,
    approved: boolean,
    reason?: string,
  ) => Promise<void>;
  checkMacPermissions: () => Promise<unknown>;
}

declare global {
  interface Window {
    tyrumDesktop: TyrumDesktopApi;
  }
}
