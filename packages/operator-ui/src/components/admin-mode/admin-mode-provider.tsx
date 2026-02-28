import type { OperatorCore } from "@tyrum/operator-core";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { OperatorUiMode } from "../../app.js";
import { AdminModeBanner } from "./admin-mode-banner.js";
import { AdminModeEnterDialog } from "./admin-mode-enter-dialog.js";

type AdminModeUiContextValue = {
  core: OperatorCore;
  mode: OperatorUiMode;
  requestEnter(): void;
  closeEnter(): void;
  isEnterOpen: boolean;
};

const AdminModeUiContext = createContext<AdminModeUiContextValue | null>(null);

export function useAdminModeUiContext(): AdminModeUiContextValue {
  const value = useContext(AdminModeUiContext);
  if (!value) {
    throw new Error("AdminMode components must be wrapped in <AdminModeProvider>.");
  }
  return value;
}

export interface AdminModeProviderProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  children: ReactNode;
}

export function AdminModeProvider({ core, mode, children }: AdminModeProviderProps) {
  const [isEnterOpen, setIsEnterOpen] = useState(false);

  return (
    <AdminModeUiContext.Provider
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
      <AdminModeBanner />
      {children}
      <AdminModeEnterDialog />
    </AdminModeUiContext.Provider>
  );
}
