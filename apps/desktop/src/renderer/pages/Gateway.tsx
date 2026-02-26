import { createTyrumHttpClient } from "@tyrum/client";
import { createBearerTokenAuth, createOperatorCore, type OperatorCore } from "@tyrum/operator-core";
import { OperatorUiApp } from "@tyrum/operator-ui";
import { useEffect, useRef, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";

type OperatorConnectionInfo = {
  mode: "embedded" | "remote";
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  tlsCertFingerprint256: string;
};

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function Gateway() {
  const api = window.tyrumDesktop;
  const [core, setCore] = useState<OperatorCore | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const coreRef = useRef<OperatorCore | null>(null);

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

        const http = createTyrumHttpClient({
          baseUrl: connection.httpBaseUrl,
          auth: { type: "bearer", token: connection.token },
          fetch: ipcFetch,
        });

        const nextCore = createOperatorCore({
          wsUrl: connection.wsUrl,
          httpBaseUrl: connection.httpBaseUrl,
          auth: createBearerTokenAuth(connection.token),
          deps: { http },
        });

        nextCore.connect();

        coreRef.current?.dispose();
        coreRef.current = nextCore;
        setCore(nextCore);
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
      coreRef.current?.dispose();
      coreRef.current = null;
    };
  }, [api]);

  if (!api) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div>Desktop API not available.</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div style={{ marginTop: 12, color: "#fecaca" }}>{errorMessage}</div>
      </div>
    );
  }

  if (!core) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div>{busy ? "Loading operator UI..." : "Operator UI not ready."}</div>
      </div>
    );
  }

  return <OperatorUiApp core={core} mode="desktop" />;
}
