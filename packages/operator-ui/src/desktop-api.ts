type DesktopMacPermission = "accessibility" | "screenRecording";

export type DesktopApi = {
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<unknown>;
  gateway: {
    getStatus: () => Promise<{ status: string; port: number }>;
    start: () => Promise<{ status: string; port: number }>;
    stop: () => Promise<{ status: string }>;
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
  node: {
    connect: () => Promise<{ status: string }>;
    disconnect: () => Promise<{ status: string }>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  checkMacPermissions?: () => Promise<unknown>;
  requestMacPermission?: (permission: DesktopMacPermission) => Promise<unknown>;
};

export function getDesktopApi(): DesktopApi | null {
  const api = (globalThis as unknown as { window?: unknown }).window as
    | { tyrumDesktop?: unknown }
    | undefined;
  if (!api?.tyrumDesktop) return null;
  return api.tyrumDesktop as DesktopApi;
}
