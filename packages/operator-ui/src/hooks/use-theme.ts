import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getDesktopApi } from "../desktop-api.js";

export type ThemeMode = "system" | "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const THEME_STORAGE_KEY = "tyrum.themeMode";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function resolveWebStoredMode(): ThemeMode | null {
  try {
    if (typeof localStorage?.getItem !== "function") return null;
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

function persistWebMode(mode: ThemeMode): void {
  try {
    if (typeof localStorage?.setItem !== "function") return;
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function resolveSystemColorScheme(): "dark" | "light" {
  if (typeof globalThis.matchMedia !== "function") {
    return "dark";
  }
  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const desktopApi = getDesktopApi();
  const [mode, setMode] = useState<ThemeMode>(() => resolveWebStoredMode() ?? "dark");
  const [systemColorScheme, setSystemColorScheme] = useState<"dark" | "light">(() =>
    resolveSystemColorScheme(),
  );

  useEffect(() => {
    if (mode !== "system") return;
    if (typeof globalThis.matchMedia !== "function") return;
    const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => {
      setSystemColorScheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => {
      mediaQuery.removeEventListener("change", handler);
    };
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode === "system" ? systemColorScheme : mode;
    root.dataset.themeMode = mode;
  }, [mode, systemColorScheme]);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
          const theme = (cfg as Record<string, unknown>)["theme"];
          if (theme && typeof theme === "object" && !Array.isArray(theme)) {
            const source = (theme as Record<string, unknown>)["source"];
            if (isThemeMode(source)) {
              setMode(source);
            }
          }
        }
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const setModeAndPersist = useCallback(
    (nextMode: ThemeMode) => {
      setMode(nextMode);
      persistWebMode(nextMode);
      if (desktopApi) {
        void desktopApi.setConfig({ theme: { source: nextMode } });
      }
    },
    [desktopApi],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode: setModeAndPersist,
    }),
    [mode, setModeAndPersist],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return value;
}
