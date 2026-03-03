import { createTyrumHttpClient } from "@tyrum/operator-core";
import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCore,
  createOperatorCoreManager,
  httpAuthForAuth,
  type ElevatedModeStore,
  type OperatorCore,
  type OperatorCoreManager,
} from "@tyrum/operator-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "./errors.js";

type OperatorConnectionInfo = {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
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
  busy: boolean;
  errorMessage: string | null;
  retry: () => void;
};

export type UseDesktopOperatorCoreOptions = {
  enabled?: boolean;
};

export function useDesktopOperatorCore(
  options?: UseDesktopOperatorCoreOptions,
): DesktopOperatorCoreState {
  const api = window.tyrumDesktop;
  const enabled = options?.enabled ?? true;
  const [core, setCore] = useState<OperatorCore | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const managerRef = useRef<OperatorCoreManager | null>(null);
  const unsubManagerRef = useRef<(() => void) | null>(null);
  const elevatedModeStoreRef = useRef<ElevatedModeStore | null>(null);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!api || !enabled) {
      setCore(null);
      setBusy(false);
      setErrorMessage(null);
      return;
    }
    let disposed = false;

    const boot = async (): Promise<void> => {
      setBusy(true);
      setErrorMessage(null);
      try {
        const connection = (await api.gateway.getOperatorConnection()) as OperatorConnectionInfo;
        if (disposed) return;

        const ipcFetch = async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
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
          return new Response(result.bodyText, {
            status: result.status,
            headers: result.headers,
          });
        };

        const elevatedModeStore = createElevatedModeStore();
        const baselineAuth = createBearerTokenAuth(connection.token);

        const manager = createOperatorCoreManager({
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
              elevatedModeStore: coreOptions.elevatedModeStore,
              deps: { http },
            });
          },
        });

        if (disposed) {
          manager.dispose();
          elevatedModeStore.dispose();
          return;
        }

        unsubManagerRef.current?.();
        managerRef.current?.dispose();
        elevatedModeStoreRef.current?.dispose();
        managerRef.current = manager;
        elevatedModeStoreRef.current = elevatedModeStore;
        setCore(manager.getCore());

        unsubManagerRef.current = manager.subscribe(() => {
          if (disposed) return;
          setCore(manager.getCore());
        });

        manager.getCore().connect();
      } catch (error) {
        if (disposed) return;
        setErrorMessage(toErrorMessage(error));
        setCore(null);
      } finally {
        if (!disposed) {
          setBusy(false);
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      unsubManagerRef.current?.();
      unsubManagerRef.current = null;
      managerRef.current?.dispose();
      managerRef.current = null;
      elevatedModeStoreRef.current?.dispose();
      elevatedModeStoreRef.current = null;
    };
  }, [api, enabled, retryCount]);

  return { core, busy, errorMessage, retry };
}
