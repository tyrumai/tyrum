import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCore,
  createOperatorCoreManager,
  createTyrumHttpClient,
  httpAuthForAuth,
  type OperatorCore,
  type OperatorCoreManager,
} from "@tyrum/operator-core/browser";
import { createAdminAccessController, type AdminAccessController } from "@tyrum/operator-ui";
import {
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
} from "@tyrum/transport-sdk/browser";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ElevatedModeStore } from "@tyrum/operator-core/browser";
import type { MobileBootstrapConfig, MobileConnectionConfig } from "./mobile-config.js";
import {
  clearMobileBootstrapConfig,
  createOperatorIdentityStorage,
  loadMobileBootstrapConfig,
  saveMobileBootstrapConfig,
  updateMobileConnectionConfig,
} from "./mobile-config.js";

type UseMobileOperatorCoreState = {
  bootstrap: MobileBootstrapConfig | null;
  core: OperatorCore | null;
  adminAccessController: AdminAccessController | null;
  busy: boolean;
  errorMessage: string | null;
  retry: () => void;
  saveConfig: (config: MobileBootstrapConfig) => Promise<void>;
  clearConfig: () => Promise<void>;
  updateConfig: (next: Partial<MobileConnectionConfig>) => Promise<MobileConnectionConfig | null>;
};

function disposeManager(
  managerRef: MutableRefObject<OperatorCoreManager | null>,
  unsubscribeRef: MutableRefObject<(() => void) | null>,
  elevatedModeStoreRef: MutableRefObject<ElevatedModeStore | null>,
) {
  unsubscribeRef.current?.();
  unsubscribeRef.current = null;
  managerRef.current?.dispose();
  managerRef.current = null;
  elevatedModeStoreRef.current?.dispose();
  elevatedModeStoreRef.current = null;
}

export function useMobileOperatorCore(): UseMobileOperatorCoreState {
  const [bootstrap, setBootstrap] = useState<MobileBootstrapConfig | null>(null);
  const [core, setCore] = useState<OperatorCore | null>(null);
  const [adminAccessController, setAdminAccessController] = useState<AdminAccessController | null>(
    null,
  );
  const [busy, setBusy] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const managerRef = useRef<OperatorCoreManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const elevatedModeStoreRef = useRef<ElevatedModeStore | null>(null);
  const connectionBootstrap = useMemo(
    () =>
      bootstrap
        ? {
            httpBaseUrl: bootstrap.httpBaseUrl,
            wsUrl: bootstrap.wsUrl,
            token: bootstrap.token,
          }
        : null,
    [bootstrap?.httpBaseUrl, bootstrap?.token, bootstrap?.wsUrl],
  );

  const retry = useCallback(() => {
    setReloadVersion((current) => current + 1);
  }, []);

  const saveConfig = useCallback(async (nextConfig: MobileBootstrapConfig) => {
    await saveMobileBootstrapConfig(nextConfig);
    setBootstrap(nextConfig);
    setErrorMessage(null);
  }, []);

  const clearConfig = useCallback(async () => {
    await clearMobileBootstrapConfig();
    setBootstrap(null);
    setCore(null);
    setAdminAccessController(null);
    setErrorMessage(null);
  }, []);

  const updateConfig = useCallback(
    async (next: Partial<MobileConnectionConfig>): Promise<MobileConnectionConfig | null> => {
      const current = bootstrap;
      if (!current) return null;
      const updated = await updateMobileConnectionConfig(current, next);
      setBootstrap(updated);
      setErrorMessage(null);
      return updated;
    },
    [bootstrap],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void loadMobileBootstrapConfig()
      .then((loaded) => {
        if (cancelled) return;
        setBootstrap(loaded);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBootstrap(null);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connectionBootstrap) {
      disposeManager(managerRef, unsubscribeRef, elevatedModeStoreRef);
      setCore(null);
      setAdminAccessController(null);
      setBusy(false);
      return;
    }

    let disposed = false;
    setBusy(true);

    void (async () => {
      try {
        const deviceIdentity = await loadOrCreateDeviceIdentity(createOperatorIdentityStorage());
        if (disposed) return;

        const elevatedModeStore = createElevatedModeStore();
        const baselineAuth = createBearerTokenAuth(connectionBootstrap.token);
        const baselineHttp = createTyrumHttpClient({
          baseUrl: connectionBootstrap.httpBaseUrl,
          auth: httpAuthForAuth(baselineAuth),
        });
        const manager = createOperatorCoreManager({
          wsUrl: connectionBootstrap.wsUrl,
          httpBaseUrl: connectionBootstrap.httpBaseUrl,
          baselineAuth,
          elevatedModeStore,
          createCore(coreOptions) {
            return createOperatorCore({
              ...coreOptions,
              deviceIdentity,
            });
          },
        });
        const controller = createAdminAccessController({
          http: baselineHttp,
          deviceId: deviceIdentity.deviceId,
          elevatedModeStore,
        });

        disposeManager(managerRef, unsubscribeRef, elevatedModeStoreRef);
        if (disposed) {
          manager.dispose();
          elevatedModeStore.dispose();
          return;
        }

        managerRef.current = manager;
        elevatedModeStoreRef.current = elevatedModeStore;
        setCore(manager.getCore());
        setAdminAccessController(controller);
        unsubscribeRef.current = manager.subscribe(() => {
          if (disposed) return;
          setCore(manager.getCore());
        });
        manager.getCore().connect();
        setErrorMessage(null);
      } catch (error) {
        if (disposed) return;
        disposeManager(managerRef, unsubscribeRef, elevatedModeStoreRef);
        setCore(null);
        setAdminAccessController(null);
        setErrorMessage(formatDeviceIdentityError(error));
      } finally {
        if (!disposed) {
          setBusy(false);
        }
      }
    })();

    return () => {
      disposed = true;
      disposeManager(managerRef, unsubscribeRef, elevatedModeStoreRef);
    };
  }, [connectionBootstrap, reloadVersion]);

  return {
    bootstrap,
    core,
    adminAccessController,
    busy,
    errorMessage,
    retry,
    saveConfig,
    clearConfig,
    updateConfig,
  };
}
