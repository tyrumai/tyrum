import * as React from "react";
import { Toaster } from "sonner";
import { useThemeOptional, type ThemeMode } from "../../hooks/use-theme.js";

export interface ToastProviderProps {
  children: React.ReactNode;
}

function resolveThemeFromDocument(): ThemeMode {
  const root = globalThis.document?.documentElement;
  const mode = root?.dataset?.themeMode;
  if (mode === "system" || mode === "light" || mode === "dark") return mode;

  const theme = root?.dataset?.theme;
  if (theme === "light" || theme === "dark") return theme;

  return "system";
}

export function ToastProvider({ children }: ToastProviderProps) {
  const theme = useThemeOptional();
  const mode = theme?.mode ?? resolveThemeFromDocument();

  return (
    <>
      {children}
      <Toaster theme={mode} />
    </>
  );
}
