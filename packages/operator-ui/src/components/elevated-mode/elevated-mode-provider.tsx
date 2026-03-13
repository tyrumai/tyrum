import {
  isElevatedModeActive,
  type ConnectionState,
  type ExternalStore,
  type OperatorCore,
} from "@tyrum/operator-core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OperatorUiMode } from "../../app.js";
import { useOperatorStore } from "../../use-operator-store.js";
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

const ElevatedModeUiContext = createContext<ElevatedModeUiContextValue | null>(null);

export function useElevatedModeUiContext(): ElevatedModeUiContextValue {
  const value = useContext(ElevatedModeUiContext);
  if (!value) {
    throw new Error("ElevatedMode components must be wrapped in <ElevatedModeProvider>.");
  }
  return value;
}

export interface AdminAccessProviderProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  adminAccessController?: ElevatedModeController;
  elevatedModeController?: ElevatedModeController;
  children: ReactNode;
}

export type ElevatedModeProviderProps = AdminAccessProviderProps;

export function ElevatedModeProvider({
  core,
  mode,
  adminAccessController,
  elevatedModeController,
  children,
}: AdminAccessProviderProps) {
  const controller = adminAccessController ?? elevatedModeController;
  const [isEnterOpen, setIsEnterOpen] = useState(false);
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const connection = useOperatorStore(
    (core as { connectionStore?: ExternalStore<ConnectionState> }).connectionStore ??
      DISCONNECTED_CONNECTION_STORE,
  );

  useEffect(() => {
    if (!controller) return;
    if (!isElevatedModeActive(elevatedMode)) return;

    if (connection.status === "connected") {
      return;
    }

    if (connection.lastDisconnect?.code !== 4001) return;

    core.elevatedModeStore.exit();
  }, [
    connection.lastDisconnect,
    connection.status,
    controller,
    core.elevatedModeStore,
    elevatedMode,
  ]);

  const enterElevatedMode = async (): Promise<void> => {
    if (controller) {
      await controller.enter();
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
    if (controller) {
      await controller.exit();
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
      <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <ElevatedModeEnterDialog />
    </ElevatedModeUiContext.Provider>
  );
}
