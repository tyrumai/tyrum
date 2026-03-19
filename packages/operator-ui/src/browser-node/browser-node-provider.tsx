import { createContext, useContext, type ReactNode } from "react";
import type { BrowserActionArgs } from "@tyrum/contracts";

export interface BrowserNodeTaskResult {
  success: boolean;
  result?: unknown;
  evidence?: unknown;
  error?: string;
}

export type BrowserCapabilityName = "get" | "capture_photo" | "record";

export type BrowserCapabilityState = {
  supported: true;
  enabled: boolean;
  availability_status: "unknown" | "available" | "unavailable";
  unavailable_reason?: string;
};

export type BrowserNodeStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface BrowserNodeState {
  enabled: boolean;
  status: BrowserNodeStatus;
  deviceId: string | null;
  clientId: string | null;
  error: string | null;
  capabilityStates: Record<BrowserCapabilityName, BrowserCapabilityState>;
}

export interface BrowserNodeApi extends BrowserNodeState {
  setEnabled: (enabled: boolean) => void;
  setCapabilityEnabled: (capability: BrowserCapabilityName, enabled: boolean) => void;
  executeLocal: (args: BrowserActionArgs) => Promise<BrowserNodeTaskResult>;
}

const BrowserNodeContext = createContext<BrowserNodeApi | null>(null);

export function BrowserNodeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: BrowserNodeApi | null;
}) {
  return <BrowserNodeContext.Provider value={value}>{children}</BrowserNodeContext.Provider>;
}

export function useBrowserNode(): BrowserNodeApi {
  const value = useContext(BrowserNodeContext);
  if (!value) {
    throw new Error("useBrowserNode must be used within BrowserNodeProvider");
  }
  return value;
}

export function useBrowserNodeOptional(): BrowserNodeApi | null {
  return useContext(BrowserNodeContext);
}
