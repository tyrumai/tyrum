import { createTyrumHttpClient } from "@tyrum/client";
import {
  createAdminModeStore,
  createBearerTokenAuth,
  createOperatorCore,
  createOperatorCoreManager,
  httpAuthForAuth,
  type AdminModeStore,
  type OperatorCore,
  type OperatorCoreManager,
} from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
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

export function useDesktopOperatorCore(): {
  core: OperatorCore | null;
  busy: boolean;
  errorMessage: string | null;
} {
  const api = window.tyrumDesktop;
  const [core, setCore] = useState<OperatorCore | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const managerRef = useRef<OperatorCoreManager | null>(null);
  const unsubManagerRef = useRef<(() => void) | null>(null);
  const adminModeStoreRef = useRef<AdminModeStore | null>(null);

  useEffect(() => {
    if (!api) return;
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

        const adminModeStore = createAdminModeStore();
        const baselineAuth = createBearerTokenAuth(connection.token);

        const manager = createOperatorCoreManager({
          wsUrl: connection.wsUrl,
          httpBaseUrl: connection.httpBaseUrl,
          baselineAuth,
          adminModeStore,
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
              adminModeStore: coreOptions.adminModeStore,
              deps: { http },
            });
          },
        });

        if (disposed) {
          manager.dispose();
          adminModeStore.dispose();
          return;
        }

        unsubManagerRef.current?.();
        managerRef.current?.dispose();
        adminModeStoreRef.current?.dispose();
        managerRef.current = manager;
        adminModeStoreRef.current = adminModeStore;
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
      adminModeStoreRef.current?.dispose();
      adminModeStoreRef.current = null;
    };
  }, [api]);

  return { core, busy, errorMessage };
}

