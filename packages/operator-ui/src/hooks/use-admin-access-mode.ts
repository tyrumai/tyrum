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

export type AdminAccessMode = "on-demand" | "always-on";

type AdminAccessModeContextValue = {
  hasStoredModePreference: boolean;
  mode: AdminAccessMode;
  setMode: (mode: AdminAccessMode) => void;
};

const STORAGE_KEY = "tyrum.adminAccessMode";

const AdminAccessModeContext = createContext<AdminAccessModeContextValue | null>(null);

function isAdminAccessMode(value: unknown): value is AdminAccessMode {
  return value === "on-demand" || value === "always-on";
}

function resolveWebStoredMode(): AdminAccessMode | null {
  try {
    if (typeof localStorage?.getItem !== "function") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isAdminAccessMode(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

function persistWebMode(mode: AdminAccessMode): void {
  try {
    if (typeof localStorage?.setItem !== "function") return;
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function AdminAccessModeProvider({ children }: { children: ReactNode }) {
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const storedMode = resolveWebStoredMode();
  const [mode, setMode] = useState<AdminAccessMode>(() => storedMode ?? "on-demand");
  const [hasStoredModePreference, setHasStoredModePreference] = useState(() => storedMode !== null);

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
          const adminAccess = (cfg as Record<string, unknown>)["adminAccess"];
          if (adminAccess && typeof adminAccess === "object" && !Array.isArray(adminAccess)) {
            const source = (adminAccess as Record<string, unknown>)["mode"];
            if (isAdminAccessMode(source)) {
              setHasStoredModePreference(true);
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
    (nextMode: AdminAccessMode) => {
      setMode(nextMode);
      persistWebMode(nextMode);
      if (desktopApi) {
        void desktopApi.setConfig({ adminAccess: { mode: nextMode } });
      }
    },
    [desktopApi],
  );

  const value = useMemo<AdminAccessModeContextValue>(
    () => ({
      hasStoredModePreference,
      mode,
      setMode: setModeAndPersist,
    }),
    [hasStoredModePreference, mode, setModeAndPersist],
  );

  return createElement(AdminAccessModeContext.Provider, { value }, children);
}

export function useAdminAccessMode(): AdminAccessModeContextValue {
  const value = useAdminAccessModeOptional();
  if (!value) {
    throw new Error("useAdminAccessMode must be used within an AdminAccessModeProvider.");
  }
  return value;
}

export function useAdminAccessModeOptional(): AdminAccessModeContextValue | null {
  return useContext(AdminAccessModeContext);
}
