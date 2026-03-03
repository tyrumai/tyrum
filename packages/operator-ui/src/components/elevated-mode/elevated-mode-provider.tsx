import type { OperatorCore } from "@tyrum/operator-core";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { OperatorUiMode } from "../../app.js";
import { ElevatedModeBanner } from "./elevated-mode-banner.js";
import { ElevatedModeEnterDialog } from "./elevated-mode-enter-dialog.js";

type ElevatedModeUiContextValue = {
  core: OperatorCore;
  mode: OperatorUiMode;
  requestEnter(): void;
  closeEnter(): void;
  isEnterOpen: boolean;
};

const ElevatedModeUiContext = createContext<ElevatedModeUiContextValue | null>(null);

export function useElevatedModeUiContext(): ElevatedModeUiContextValue {
  const value = useContext(ElevatedModeUiContext);
  if (!value) {
    throw new Error("ElevatedMode components must be wrapped in <ElevatedModeProvider>.");
  }
  return value;
}

export interface ElevatedModeProviderProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  children: ReactNode;
}

export function ElevatedModeProvider({ core, mode, children }: ElevatedModeProviderProps) {
  const [isEnterOpen, setIsEnterOpen] = useState(false);

  return (
    <ElevatedModeUiContext.Provider
      value={{
        core,
        mode,
        isEnterOpen,
        requestEnter() {
          setIsEnterOpen(true);
        },
        closeEnter() {
          setIsEnterOpen(false);
        },
      }}
    >
      <ElevatedModeBanner />
      {children}
      <ElevatedModeEnterDialog />
    </ElevatedModeUiContext.Provider>
  );
}
