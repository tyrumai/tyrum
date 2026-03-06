import {
  isElevatedModeActive,
  type ConnectionState,
  type ExternalStore,
  type OperatorCore,
} from "@tyrum/operator-core";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OperatorUiMode } from "../../app.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { ElevatedModeChrome } from "./elevated-mode-chrome.js";
import { ELEVATED_MODE_SCOPES, type ElevatedModeController } from "./elevated-mode-controller.js";
import { ElevatedModeEnterDialog } from "./elevated-mode-enter-dialog.js";

type ElevatedModeUiContextValue = {
  core: OperatorCore;
  mode: OperatorUiMode;
  enterElevatedMode(): Promise<void>;
  exitElevatedMode(): Promise<void>;
  requestEnter(): void;
  closeEnter(): void;
  isEnterOpen: boolean;
};

const ELEVATED_MODE_STORAGE_KEY = "tyrum.operator-ui.elevated-mode.v1";
const DISCONNECTED_CONNECTION_STATE: ConnectionState = {
  status: "disconnected",
  recovering: false,
  nextRetryAtMs: null,
  clientId: null,
  lastDisconnect: null,
  transportError: null,
};
const DISCONNECTED_CONNECTION_STORE: ExternalStore<ConnectionState> = {
  subscribe: () => () => {},
  getSnapshot: () => DISCONNECTED_CONNECTION_STATE,
};

type PersistedElevatedModeState = {
  httpBaseUrl: string;
  deviceId: string;
  elevatedToken: string;
  expiresAt: string | null;
};

function getStorage(candidate: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const storage = globalThis[candidate];
    if (!storage || typeof storage.getItem !== "function") return null;
    return storage;
  } catch {
    return null;
  }
}

function getPreferredStorage(mode: OperatorUiMode): Storage | null {
  if (mode === "web") {
    return getStorage("sessionStorage") ?? getStorage("localStorage");
  }
  return getStorage("localStorage") ?? getStorage("sessionStorage");
}

function getLegacyStorage(mode: OperatorUiMode, preferred: Storage | null): Storage | null {
  if (mode !== "web") return null;
  const localStorage = getStorage("localStorage");
  if (!localStorage || localStorage === preferred) return null;
  return localStorage;
}

function clearStorageKey(storage: Storage | null): void {
  try {
    if (!storage || typeof storage.removeItem !== "function") return;
    storage.removeItem(ELEVATED_MODE_STORAGE_KEY);
  } catch {
    // storage unavailable
  }
}

function parsePersistedElevatedModeState(raw: string): PersistedElevatedModeState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record["httpBaseUrl"] !== "string" ||
      typeof record["deviceId"] !== "string" ||
      typeof record["elevatedToken"] !== "string"
    ) {
      return null;
    }
    const expiresAt = record["expiresAt"];
    if (expiresAt !== null && typeof expiresAt !== "string") return null;
    if (typeof expiresAt === "string" && !Number.isFinite(Date.parse(expiresAt))) return null;
    return {
      httpBaseUrl: record["httpBaseUrl"],
      deviceId: record["deviceId"],
      elevatedToken: record["elevatedToken"],
      expiresAt,
    };
  } catch {
    return null;
  }
}

function readPersistedElevatedModeState(mode: OperatorUiMode): PersistedElevatedModeState | null {
  const preferred = getPreferredStorage(mode);
  const legacy = getLegacyStorage(mode, preferred);

  const readFromStorage = (storage: Storage | null): PersistedElevatedModeState | null => {
    try {
      if (!storage || typeof storage.getItem !== "function") return null;
      const raw = storage.getItem(ELEVATED_MODE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = parsePersistedElevatedModeState(raw);
      if (parsed) return parsed;
      clearStorageKey(storage);
      return null;
    } catch {
      return null;
    }
  };

  const preferredState = readFromStorage(preferred);
  if (preferredState) return preferredState;

  const legacyState = readFromStorage(legacy);
  if (!legacyState) return null;

  persistElevatedModeState(mode, legacyState);
  clearStorageKey(legacy);
  return legacyState;
}

function persistElevatedModeState(mode: OperatorUiMode, state: PersistedElevatedModeState): void {
  const preferred = getPreferredStorage(mode);
  const legacy = getLegacyStorage(mode, preferred);
  try {
    if (!preferred || typeof preferred.setItem !== "function") return;
    preferred.setItem(ELEVATED_MODE_STORAGE_KEY, JSON.stringify(state));
    clearStorageKey(legacy);
  } catch {
    // storage unavailable
  }
}

function clearPersistedElevatedModeState(mode: OperatorUiMode): void {
  const preferred = getPreferredStorage(mode);
  const legacy = getLegacyStorage(mode, preferred);
  clearStorageKey(preferred);
  clearStorageKey(legacy);
}

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
  elevatedModeController?: ElevatedModeController;
  children: ReactNode;
}

export function ElevatedModeProvider({
  core,
  mode,
  elevatedModeController,
  children,
}: ElevatedModeProviderProps) {
  const [isEnterOpen, setIsEnterOpen] = useState(false);
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const connection = useOperatorStore(
    (core as { connectionStore?: ExternalStore<ConnectionState> }).connectionStore ??
      DISCONNECTED_CONNECTION_STORE,
  );
  const restorePendingRef = useRef(false);
  const restoredTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!elevatedModeController) return;
    if (isElevatedModeActive(core.elevatedModeStore.getSnapshot())) return;

    const persisted = readPersistedElevatedModeState(mode);
    const deviceId = core.deviceId?.trim();
    if (
      !persisted ||
      !deviceId ||
      persisted.deviceId !== deviceId ||
      persisted.httpBaseUrl !== core.httpBaseUrl
    ) {
      if (persisted) {
        clearPersistedElevatedModeState(mode);
      }
      restorePendingRef.current = false;
      restoredTokenRef.current = null;
      return;
    }

    try {
      restorePendingRef.current = true;
      restoredTokenRef.current = persisted.elevatedToken;
      core.elevatedModeStore.enter({
        elevatedToken: persisted.elevatedToken,
        expiresAt: persisted.expiresAt,
      });
      if (!isElevatedModeActive(core.elevatedModeStore.getSnapshot())) {
        restorePendingRef.current = false;
        restoredTokenRef.current = null;
        clearPersistedElevatedModeState(mode);
      }
    } catch {
      restorePendingRef.current = false;
      restoredTokenRef.current = null;
      clearPersistedElevatedModeState(mode);
    }
  }, [core, elevatedModeController, mode]);

  useEffect(() => {
    if (!restorePendingRef.current) return;
    if (!isElevatedModeActive(elevatedMode)) return;
    restorePendingRef.current = false;
  }, [elevatedMode]);

  useEffect(() => {
    if (!elevatedModeController) return;

    if (!isElevatedModeActive(elevatedMode)) {
      if (restorePendingRef.current) return;
      clearPersistedElevatedModeState(mode);
      return;
    }

    const deviceId = core.deviceId?.trim();
    if (!deviceId) return;

    persistElevatedModeState(mode, {
      httpBaseUrl: core.httpBaseUrl,
      deviceId,
      elevatedToken: elevatedMode.elevatedToken!,
      expiresAt: elevatedMode.expiresAt ?? null,
    });
  }, [core.deviceId, core.httpBaseUrl, elevatedMode, elevatedModeController, mode]);

  useEffect(() => {
    if (!elevatedModeController) return;
    if (!isElevatedModeActive(elevatedMode)) return;

    if (connection.status === "connected") {
      restoredTokenRef.current = null;
      return;
    }

    if (connection.lastDisconnect?.code !== 4001) return;

    restorePendingRef.current = false;
    restoredTokenRef.current = null;
    clearPersistedElevatedModeState(mode);
    core.elevatedModeStore.exit();
  }, [connection.lastDisconnect, connection.status, core.elevatedModeStore, elevatedMode, mode]);

  const enterElevatedMode = async (): Promise<void> => {
    if (elevatedModeController) {
      await elevatedModeController.enter();
      return;
    }

    const deviceId = core.deviceId?.trim();
    if (!deviceId) {
      throw new Error("Current client device identity is unavailable.");
    }

    const issued = await core.http.deviceTokens.issue({
      device_id: deviceId,
      role: "client",
      scopes: [...ELEVATED_MODE_SCOPES],
      ttl_seconds: 60 * 10,
    });
    if (!issued.expires_at) {
      throw new Error("Gateway returned a timed elevated-mode token without expires_at.");
    }

    core.elevatedModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

  const exitElevatedMode = async (): Promise<void> => {
    if (elevatedModeController) {
      await elevatedModeController.exit();
      return;
    }
    core.elevatedModeStore.exit();
  };

  return (
    <ElevatedModeUiContext.Provider
      value={{
        core,
        mode,
        enterElevatedMode,
        exitElevatedMode,
        isEnterOpen,
        requestEnter() {
          setIsEnterOpen(true);
        },
        closeEnter() {
          setIsEnterOpen(false);
        },
      }}
    >
      <div className="relative isolate">
        <ElevatedModeChrome />
        {children}
      </div>
      <ElevatedModeEnterDialog />
    </ElevatedModeUiContext.Provider>
  );
}
