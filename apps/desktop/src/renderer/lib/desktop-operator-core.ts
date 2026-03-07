import { createTyrumHttpClient } from "@tyrum/operator-core/browser";
import {
  createBearerTokenAuth,
  createDeviceIdentity,
  createElevatedModeStore,
  createOperatorCore,
  createOperatorCoreManager,
  httpAuthForAuth,
  type ElevatedModeStore,
  type OperatorCore,
  type OperatorCoreManager,
} from "@tyrum/operator-core/browser";
import {
  createPersistentElevatedModeController,
  type ElevatedModeController,
} from "@tyrum/operator-ui";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toErrorMessage } from "./errors.js";

type OperatorConnectionInfo = {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
  tlsAllowSelfSigned: boolean;
};

export function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export type DesktopOperatorCoreState = {
  core: OperatorCore | null;
  elevatedModeController: ElevatedModeController | null;
  busy: boolean;
  errorMessage: string | null;
  needsConfiguration: boolean;
  retry: () => void;
};

export type UseDesktopOperatorCoreOptions = {
  enabled?: boolean;
};

type DesktopApi = NonNullable<typeof window.tyrumDesktop>;

type DesktopIpcFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function resetDesktopOperatorCoreState({
  setCore,
  setElevatedModeController,
  setBusy,
  setErrorMessage,
  setNeedsConfiguration,
}: {
  setCore: (core: OperatorCore | null) => void;
  setElevatedModeController: (controller: ElevatedModeController | null) => void;
  setBusy: (busy: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  setNeedsConfiguration: (needsConfiguration: boolean) => void;
}): void {
  setCore(null);
  setElevatedModeController(null);
  setBusy(false);
  setErrorMessage(null);
  setNeedsConfiguration(false);
}

function createDesktopIpcFetch(api: DesktopApi): DesktopIpcFetch {
  return async (input, init): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = headersToRecord(init?.headers);
    const result = await api.gateway.httpFetch({
      url,
      init: {
        method: init?.method,
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      },
    });
    return new Response(result.bodyText, { status: result.status, headers: result.headers });
  };
}

function createDesktopOperatorCoreManager({
  connection,
  ipcFetch,
  deviceIdentity,
  elevatedModeStore,
}: {
  connection: OperatorConnectionInfo;
  ipcFetch: DesktopIpcFetch;
  deviceIdentity: Awaited<ReturnType<typeof createDeviceIdentity>>;
  elevatedModeStore: ElevatedModeStore;
}): OperatorCoreManager {
  const baselineAuth = createBearerTokenAuth(connection.token);
  return createOperatorCoreManager({
    wsUrl: connection.wsUrl,
    httpBaseUrl: connection.httpBaseUrl,
    baselineAuth,
    elevatedModeStore,
    createCore(coreOptions) {
      const http = createTyrumHttpClient({
        baseUrl: coreOptions.httpBaseUrl,
        auth: httpAuthForAuth(coreOptions.auth),
        fetch: ipcFetch,
      });
      return createOperatorCore({
        wsUrl: coreOptions.wsUrl,
        httpBaseUrl: coreOptions.httpBaseUrl,
        auth: coreOptions.auth,
        deviceIdentity,
        elevatedModeStore: coreOptions.elevatedModeStore,
        deps: { http },
      });
    },
  });
}

function createDesktopElevatedModeController({
  connection,
  ipcFetch,
  deviceIdentity,
  elevatedModeStore,
}: {
  connection: OperatorConnectionInfo;
  ipcFetch: DesktopIpcFetch;
  deviceIdentity: Awaited<ReturnType<typeof createDeviceIdentity>>;
  elevatedModeStore: ElevatedModeStore;
}): ElevatedModeController {
  const baselineAuth = createBearerTokenAuth(connection.token);
  const http = createTyrumHttpClient({
    baseUrl: connection.httpBaseUrl,
    auth: httpAuthForAuth(baselineAuth),
    fetch: ipcFetch,
  });
  return createPersistentElevatedModeController({
    http,
    deviceId: deviceIdentity.deviceId,
    elevatedModeStore,
  });
}

function installDesktopOperatorCoreManager({
  manager,
  elevatedModeStore,
  managerRef,
  unsubManagerRef,
  elevatedModeStoreRef,
  isDisposed,
  setCore,
}: {
  manager: OperatorCoreManager;
  elevatedModeStore: ElevatedModeStore;
  managerRef: MutableRefObject<OperatorCoreManager | null>;
  unsubManagerRef: MutableRefObject<(() => void) | null>;
  elevatedModeStoreRef: MutableRefObject<ElevatedModeStore | null>;
  isDisposed: () => boolean;
  setCore: (core: OperatorCore | null) => void;
}): void {
  unsubManagerRef.current?.();
  managerRef.current?.dispose();
  elevatedModeStoreRef.current?.dispose();

  managerRef.current = manager;
  elevatedModeStoreRef.current = elevatedModeStore;

  setCore(manager.getCore());
  unsubManagerRef.current = manager.subscribe(() => {
    if (isDisposed()) return;
    setCore(manager.getCore());
  });
}

function disposeDesktopOperatorCoreManager({
  managerRef,
  unsubManagerRef,
  elevatedModeStoreRef,
}: {
  managerRef: MutableRefObject<OperatorCoreManager | null>;
  unsubManagerRef: MutableRefObject<(() => void) | null>;
  elevatedModeStoreRef: MutableRefObject<ElevatedModeStore | null>;
}): void {
  unsubManagerRef.current?.();
  unsubManagerRef.current = null;
  managerRef.current?.dispose();
  managerRef.current = null;
  elevatedModeStoreRef.current?.dispose();
  elevatedModeStoreRef.current = null;
}

async function bootDesktopOperatorCore({
  api,
  isDisposed,
  managerRef,
  unsubManagerRef,
  elevatedModeStoreRef,
  setCore,
  setElevatedModeController,
  setBusy,
  setErrorMessage,
  setNeedsConfiguration,
}: {
  api: DesktopApi;
  isDisposed: () => boolean;
  managerRef: MutableRefObject<OperatorCoreManager | null>;
  unsubManagerRef: MutableRefObject<(() => void) | null>;
  elevatedModeStoreRef: MutableRefObject<ElevatedModeStore | null>;
  setCore: (core: OperatorCore | null) => void;
  setElevatedModeController: (controller: ElevatedModeController | null) => void;
  setBusy: (busy: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  setNeedsConfiguration: (needsConfiguration: boolean) => void;
}): Promise<void> {
  setBusy(true);
  setErrorMessage(null);

  try {
    const hasConfig = await api.configExists();
    if (isDisposed()) return;

    if (!hasConfig) {
      setNeedsConfiguration(true);
      setCore(null);
      setElevatedModeController(null);
      setErrorMessage(null);
      return;
    }

    setNeedsConfiguration(false);

    const connection = (await api.gateway.getOperatorConnection()) as OperatorConnectionInfo;
    if (isDisposed()) return;

    const deviceIdentity = await createDeviceIdentity();
    if (isDisposed()) return;

    const elevatedModeStore = createElevatedModeStore();
    let manager: OperatorCoreManager;
    try {
      manager = createDesktopOperatorCoreManager({
        connection,
        ipcFetch: createDesktopIpcFetch(api),
        deviceIdentity,
        elevatedModeStore,
      });
    } catch (err) {
      elevatedModeStore.dispose();
      throw err;
    }

    const elevatedModeController = createDesktopElevatedModeController({
      connection,
      ipcFetch: createDesktopIpcFetch(api),
      deviceIdentity,
      elevatedModeStore,
    });

    if (isDisposed()) {
      manager.dispose();
      elevatedModeStore.dispose();
      return;
    }

    installDesktopOperatorCoreManager({
      manager,
      elevatedModeStore,
      managerRef,
      unsubManagerRef,
      elevatedModeStoreRef,
      isDisposed,
      setCore,
    });
    setElevatedModeController(elevatedModeController);
    manager.getCore().connect();
  } catch (err) {
    if (isDisposed()) return;
    disposeDesktopOperatorCoreManager({
      managerRef,
      unsubManagerRef,
      elevatedModeStoreRef,
    });
    setElevatedModeController(null);
    setCore(null);
    setNeedsConfiguration(false);
    setErrorMessage(toErrorMessage(err));
  } finally {
    if (!isDisposed()) {
      setBusy(false);
    }
  }
}

export function useDesktopOperatorCore(
  opts: UseDesktopOperatorCoreOptions = {},
): DesktopOperatorCoreState {
  const enabled = opts.enabled ?? true;
  const [core, setCore] = useState<OperatorCore | null>(null);
  const [elevatedModeController, setElevatedModeController] =
    useState<ElevatedModeController | null>(null);
  const [busy, setBusy] = useState(enabled);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const managerRef = useRef<OperatorCoreManager | null>(null);
  const unsubManagerRef = useRef<(() => void) | null>(null);
  const elevatedModeStoreRef = useRef<ElevatedModeStore | null>(null);

  const retry = useCallback(() => {
    setBusy(true);
    setErrorMessage(null);
    setNeedsConfiguration(false);
    setRetryCount((count) => count + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      disposeDesktopOperatorCoreManager({
        managerRef,
        unsubManagerRef,
        elevatedModeStoreRef,
      });
      resetDesktopOperatorCoreState({
        setCore,
        setElevatedModeController,
        setBusy,
        setErrorMessage,
        setNeedsConfiguration,
      });
      return;
    }

    const api = window.tyrumDesktop;
    if (!api) {
      setBusy(false);
      setErrorMessage("Desktop API unavailable.");
      return;
    }

    let disposed = false;
    const isDisposed = (): boolean => disposed;

    void bootDesktopOperatorCore({
      api,
      isDisposed,
      managerRef,
      unsubManagerRef,
      elevatedModeStoreRef,
      setCore,
      setElevatedModeController,
      setBusy,
      setErrorMessage,
      setNeedsConfiguration,
    });

    return () => {
      disposed = true;
      disposeDesktopOperatorCoreManager({
        managerRef,
        unsubManagerRef,
        elevatedModeStoreRef,
      });
      setElevatedModeController(null);
    };
  }, [enabled, retryCount]);

  return { core, elevatedModeController, busy, errorMessage, needsConfiguration, retry };
}
