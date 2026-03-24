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
import { useHostApiOptional } from "../host/host-api.js";

export type ThemeMode = "system" | "light" | "dark";

export type ColorPalette = "copper" | "ocean" | "ember" | "sage" | "neon";

export const COLOR_PALETTES: readonly ColorPalette[] = [
  "copper",
  "ocean",
  "ember",
  "sage",
  "neon",
] as const;

type ThemeContextValue = {
  hasStoredModePreference: boolean;
  hasStoredPalettePreference: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  palette: ColorPalette;
  setPalette: (palette: ColorPalette) => void;
};

const THEME_STORAGE_KEY = "tyrum.themeMode";
const PALETTE_STORAGE_KEY = "tyrum.colorPalette";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isColorPalette(value: unknown): value is ColorPalette {
  return (
    value === "copper" ||
    value === "ocean" ||
    value === "ember" ||
    value === "sage" ||
    value === "neon"
  );
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

function resolveWebStoredPalette(): ColorPalette | null {
  try {
    if (typeof localStorage?.getItem !== "function") return null;
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (isColorPalette(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

function persistWebPalette(palette: ColorPalette): void {
  try {
    if (typeof localStorage?.setItem !== "function") return;
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // ignore
  }
}

function resolveSystemColorScheme(): "dark" | "light" {
  if (typeof globalThis.matchMedia !== "function") {
    return "dark";
  }
  try {
    return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const storedMode = resolveWebStoredMode();
  const storedPalette = resolveWebStoredPalette();
  const [mode, setMode] = useState<ThemeMode>(() => storedMode ?? "dark");
  const [palette, setPalette] = useState<ColorPalette>(() => storedPalette ?? "copper");
  const [hasStoredModePreference, setHasStoredModePreference] = useState(() => storedMode !== null);
  const [hasStoredPalettePreference, setHasStoredPalettePreference] = useState(
    () => storedPalette !== null,
  );
  const [systemColorScheme, setSystemColorScheme] = useState<"dark" | "light">(() =>
    resolveSystemColorScheme(),
  );

  useEffect(() => {
    if (mode !== "system") return;
    if (typeof globalThis.matchMedia !== "function") return;
    let mediaQuery: MediaQueryList;
    try {
      mediaQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    setSystemColorScheme(mediaQuery.matches ? "dark" : "light");
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
    const root = document.documentElement;
    if (palette === "copper") {
      delete root.dataset.palette;
    } else {
      root.dataset.palette = palette;
    }
  }, [palette]);

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
              setHasStoredModePreference(true);
              setMode(source);
            }
            const colorPalette = (theme as Record<string, unknown>)["colorPalette"];
            if (isColorPalette(colorPalette)) {
              setHasStoredPalettePreference(true);
              setPalette(colorPalette);
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

  const setPaletteAndPersist = useCallback(
    (nextPalette: ColorPalette) => {
      setPalette(nextPalette);
      persistWebPalette(nextPalette);
      if (desktopApi) {
        void desktopApi.setConfig({ theme: { colorPalette: nextPalette } });
      }
    },
    [desktopApi],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      hasStoredModePreference,
      hasStoredPalettePreference,
      mode,
      setMode: setModeAndPersist,
      palette,
      setPalette: setPaletteAndPersist,
    }),
    [
      hasStoredModePreference,
      hasStoredPalettePreference,
      mode,
      setModeAndPersist,
      palette,
      setPaletteAndPersist,
    ],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useThemeOptional();
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return value;
}

export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
