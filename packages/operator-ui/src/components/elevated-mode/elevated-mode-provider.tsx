import { isElevatedModeActive, type OperatorCore } from "@tyrum/operator-core";
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

type PersistedElevatedModeState = {
  httpBaseUrl: string;
  deviceId: string;
  elevatedToken: string;
  expiresAt: string | null;
};

function readPersistedElevatedModeState(): PersistedElevatedModeState | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.getItem !== "function") return null;
    const raw = storage.getItem(ELEVATED_MODE_STORAGE_KEY);
    if (!raw) return null;
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

function persistElevatedModeState(state: PersistedElevatedModeState): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.setItem !== "function") return;
    storage.setItem(ELEVATED_MODE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable
  }
}

function clearPersistedElevatedModeState(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage || typeof storage.removeItem !== "function") return;
    storage.removeItem(ELEVATED_MODE_STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
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
  const connection = useOperatorStore(core.connectionStore);
  const restorePendingRef = useRef(false);
  const restoredTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!elevatedModeController) return;
    if (isElevatedModeActive(core.elevatedModeStore.getSnapshot())) return;

    const persisted = readPersistedElevatedModeState();
    const deviceId = core.deviceId?.trim();
    if (
      !persisted ||
      !deviceId ||
      persisted.deviceId !== deviceId ||
      persisted.httpBaseUrl !== core.httpBaseUrl
    ) {
      if (persisted) {
        clearPersistedElevatedModeState();
      }
      restorePendingRef.current = false;
      restoredTokenRef.current = null;
      return;
    }

    restorePendingRef.current = true;
    restoredTokenRef.current = persisted.elevatedToken;
    core.elevatedModeStore.enter({
      elevatedToken: persisted.elevatedToken,
      expiresAt: persisted.expiresAt,
    });
  }, [core, elevatedModeController]);

  useEffect(() => {
    if (!restorePendingRef.current) return;
    if (!isElevatedModeActive(elevatedMode)) return;
    restorePendingRef.current = false;
  }, [elevatedMode]);

  useEffect(() => {
    if (!elevatedModeController) return;

    if (!isElevatedModeActive(elevatedMode)) {
      if (restorePendingRef.current) return;
      clearPersistedElevatedModeState();
      return;
    }

    const deviceId = core.deviceId?.trim();
    if (!deviceId) return;

    persistElevatedModeState({
      httpBaseUrl: core.httpBaseUrl,
      deviceId,
      elevatedToken: elevatedMode.elevatedToken!,
      expiresAt: elevatedMode.expiresAt ?? null,
    });
  }, [core.deviceId, core.httpBaseUrl, elevatedMode, elevatedModeController]);

  useEffect(() => {
    const restoredToken = restoredTokenRef.current;
    if (!restoredToken) return;
    if (!isElevatedModeActive(elevatedMode)) return;
    if (elevatedMode.elevatedToken !== restoredToken) return;

    if (connection.status === "connected") {
      restoredTokenRef.current = null;
      return;
    }

    if (connection.lastDisconnect?.code !== 4001) return;

    restorePendingRef.current = false;
    restoredTokenRef.current = null;
    clearPersistedElevatedModeState();
    core.elevatedModeStore.exit();
  }, [connection.lastDisconnect, connection.status, core.elevatedModeStore, elevatedMode]);

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
