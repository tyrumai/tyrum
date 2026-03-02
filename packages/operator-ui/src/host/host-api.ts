import * as React from "react";
import type { DesktopApi } from "../desktop-api.js";

export type HostKind = "web" | "desktop";

export type OperatorUiHostApi =
  | {
      kind: "web";
    }
  | {
      kind: "desktop";
      api: DesktopApi | null;
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
