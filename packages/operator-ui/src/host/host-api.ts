import * as React from "react";
import type { DesktopApi } from "../desktop-api.js";

export type MobileHostPlatform = "ios" | "android";

export type MobileHostActionName =
  | "location.get_current"
  | "camera.capture_photo"
  | "audio.record_clip";

export interface MobileHostActionState {
  enabled: boolean;
  availabilityStatus: "ready" | "unavailable";
  unavailableReason?: string | null;
}

export interface MobileHostState {
  platform: MobileHostPlatform;
  enabled: boolean;
  status: "disconnected" | "connecting" | "connected";
  deviceId: string | null;
  error?: string | null;
  actions: Record<MobileHostActionName, MobileHostActionState>;
}

export interface MobileHostApi {
  node: {
    getState: () => Promise<MobileHostState>;
    setEnabled: (enabled: boolean) => Promise<MobileHostState>;
    setActionEnabled: (action: MobileHostActionName, enabled: boolean) => Promise<MobileHostState>;
  };
  clipboard?: {
    writeText: (text: string) => Promise<void>;
  };
  onStateChange?: (cb: (state: MobileHostState) => void) => () => void;
  onNavigationRequest?: (cb: (request: unknown) => void) => () => void;
}

export type HostKind = "web" | "desktop" | "mobile";

export type OperatorUiHostApi =
  | {
      kind: "web";
    }
  | {
      kind: "desktop";
      api: DesktopApi | null;
    }
  | {
      kind: "mobile";
      api: MobileHostApi;
    };

const HostApiContext = React.createContext<OperatorUiHostApi | null>(null);

export interface OperatorUiHostProviderProps {
  value: OperatorUiHostApi;
  children: React.ReactNode;
}

export function OperatorUiHostProvider({ value, children }: OperatorUiHostProviderProps) {
  return React.createElement(HostApiContext.Provider, { value }, children);
}

export function useHostApiOptional(): OperatorUiHostApi | null {
  return React.useContext(HostApiContext);
}

export function useHostApi(): OperatorUiHostApi {
  const value = useHostApiOptional();
  if (!value) {
    throw new Error("useHostApi must be used within an OperatorUiHostProvider.");
  }
  return value;
}
