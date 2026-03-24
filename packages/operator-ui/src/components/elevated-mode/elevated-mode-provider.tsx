import {
  isElevatedModeActive,
  type ConnectionState,
  type ExternalStore,
  type OperatorCore,
} from "@tyrum/operator-app";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OperatorUiMode } from "../../app.js";
import { useAdminAccessModeOptional } from "../../hooks/use-admin-access-mode.js";
import { useOperatorStore } from "../../use-operator-store.js";
import {
  ADMIN_ACCESS_TTL_SECONDS,
  ELEVATED_MODE_SCOPES,
  type ElevatedModeController,
} from "./elevated-mode-controller.js";
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

const RENEWAL_THRESHOLD_MS = ADMIN_ACCESS_TTL_SECONDS * 1000 * 0.2;

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
  const adminAccessModeSetting = useAdminAccessModeOptional();
  const adminAccessMode = adminAccessModeSetting?.mode ?? "on-demand";
  const autoEnterAttemptedRef = useRef(false);
  const renewingRef = useRef(false);
  const adminAccessModeRef = useRef(adminAccessMode);
  const previousAdminAccessModeRef = useRef(adminAccessMode);
  adminAccessModeRef.current = adminAccessMode;

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

    const issued = await core.admin.deviceTokens.issue({
      device_id: deviceId,
      role: "client",
      scopes: [...ELEVATED_MODE_SCOPES],
      ttl_seconds: ADMIN_ACCESS_TTL_SECONDS,
    });
    if (!issued.expires_at) {
      throw new Error("Gateway returned a timed elevated-mode token without expires_at.");
    }

    core.elevatedModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

  const exitElevatedMode = useCallback(async (): Promise<void> => {
    if (controller) {
      await controller.exit();
      return;
    }
    core.elevatedModeStore.exit();
  }, [controller, core.elevatedModeStore]);

  useEffect(() => {
    const previousMode = previousAdminAccessModeRef.current;
    previousAdminAccessModeRef.current = adminAccessMode;

    if (previousMode !== "always-on" || adminAccessMode !== "on-demand") return;
    if (!isElevatedModeActive(elevatedMode)) return;
    if (adminAccessModeSetting?.preserveElevatedSessionOnLastModeChange) return;

    void exitElevatedMode().catch(() => {
      core.elevatedModeStore.exit();
    });
  }, [
    adminAccessMode,
    adminAccessModeSetting?.preserveElevatedSessionOnLastModeChange,
    core.elevatedModeStore,
    elevatedMode,
    exitElevatedMode,
  ]);

  // Auto-enter elevated mode when "always-on" and connected.
  // autoEnterAttemptedRef guards against concurrent duplicate requests
  // and is kept set after failure to prevent retry loops. On success it
  // is cleared so that a later token expiry can trigger re-entry.
  useEffect(() => {
    if (adminAccessMode !== "always-on") {
      autoEnterAttemptedRef.current = false;
      return;
    }
    if (connection.status !== "connected") {
      autoEnterAttemptedRef.current = false;
      return;
    }
    if (isElevatedModeActive(elevatedMode)) return;
    if (autoEnterAttemptedRef.current) return;
    if (renewingRef.current) return;

    autoEnterAttemptedRef.current = true;
    void (async () => {
      try {
        await enterElevatedMode();
        if (adminAccessModeRef.current !== "always-on") {
          // Mode changed while the request was in-flight. Undo.
          core.elevatedModeStore.exit();
          return;
        }
        // Success: clear the guard so a future token expiry can re-trigger.
        // The isElevatedModeActive check above prevents immediate re-entry.
        autoEnterAttemptedRef.current = false;
      } catch {
        // Failure: keep autoEnterAttemptedRef set to prevent retry loops.
        // A disconnect/reconnect or mode toggle will reset it.
      }
    })();
  });

  // Auto-renew elevated mode token when "always-on" and nearing expiry.
  // renewingRef prevents concurrent renewal requests. It is always reset
  // when the async operation completes — refs are safe to mutate after
  // effect cleanup, unlike React state.
  useEffect(() => {
    if (adminAccessMode !== "always-on") return;
    if (elevatedMode.status !== "active") return;
    if (elevatedMode.remainingMs === null) return;
    if (elevatedMode.remainingMs > RENEWAL_THRESHOLD_MS) return;
    if (renewingRef.current) return;

    renewingRef.current = true;
    void (async () => {
      try {
        await enterElevatedMode();
        if (adminAccessModeRef.current !== "always-on") {
          // Mode changed while the renewal was in-flight. Undo.
          core.elevatedModeStore.exit();
        }
        // Success: allow future renewals.
        renewingRef.current = false;
      } catch {
        // Failure: keep renewingRef set to prevent a retry storm (~1 req/s).
        // The existing token still has time left. When it expires, the
        // auto-enter effect will attempt re-entry.
      }
    })();
  });

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
