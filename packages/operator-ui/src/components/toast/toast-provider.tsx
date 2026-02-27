import * as React from "react";
import { Toaster } from "sonner";
import { useTheme } from "../../hooks/use-theme.js";

export interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const { mode } = useTheme();

  return (
    <>
      {children}
      <Toaster theme={mode} />
    </>
  );
}
