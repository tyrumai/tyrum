import { createTyrumHttpClient, type TyrumHttpFetch } from "@tyrum/client";
import { isAdminModeActive, type AdminModeState, type OperatorCore } from "@tyrum/operator-core";
import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { OperatorUiMode } from "./app.js";

interface ExternalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}

function useOperatorStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function formatAdminModeRemaining(state: AdminModeState): string {
  const remainingMs =
    state.remainingMs ??
    (state.expiresAt ? Math.max(0, Date.parse(state.expiresAt) - Date.now()) : null);
  if (remainingMs === null) return "--:--";

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

type DesktopApi = {
  gateway: {
    httpFetch: (input: {
      url: string;
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      };
    }) => Promise<{
      status: number;
      headers: Record<string, string>;
      bodyText: string;
    }>;
  };
};

function getDesktopApi(): DesktopApi | null {
  const api = (globalThis as unknown as { window?: unknown }).window as
    | { tyrumDesktop?: unknown }
    | undefined;
  if (!api?.tyrumDesktop) return null;
  const desktop = api.tyrumDesktop as { gateway?: unknown };
  if (!desktop.gateway || typeof desktop.gateway !== "object" || Array.isArray(desktop.gateway)) {
    return null;
  }
  const gateway = desktop.gateway as { httpFetch?: unknown };
  if (typeof gateway.httpFetch !== "function") return null;
  return desktop as unknown as DesktopApi;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function resolveHttpFetch(mode: OperatorUiMode): TyrumHttpFetch | undefined {
  if (mode !== "desktop") return undefined;
  const api = getDesktopApi();
  if (!api) return undefined;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type AdminModeUiContextValue = {
  core: OperatorCore;
  mode: OperatorUiMode;
  requestEnter(): void;
  closeEnter(): void;
  isEnterOpen: boolean;
};

const AdminModeUiContext = createContext<AdminModeUiContextValue | null>(null);

function useAdminModeUiContext(): AdminModeUiContextValue {
  const value = useContext(AdminModeUiContext);
  if (!value) {
    throw new Error("AdminMode components must be wrapped in <AdminModeProvider>.");
  }
  return value;
}

export interface AdminModeProviderProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  children: ReactNode;
}

export function AdminModeProvider({ core, mode, children }: AdminModeProviderProps) {
  const [isEnterOpen, setIsEnterOpen] = useState(false);

  return (
    <AdminModeUiContext.Provider
      value={{
        core,
        mode,
        isEnterOpen,
        requestEnter() {
          setIsEnterOpen(true);
        },
        closeEnter() {
          setIsEnterOpen(false);
        },
      }}
    >
      <AdminModeBanner />
      {children}
      {isEnterOpen ? <AdminModeEnterDialog /> : null}
    </AdminModeUiContext.Provider>
  );
}

export function AdminModeBanner() {
  const { core } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);

  if (!isAdminModeActive(adminMode)) return null;

  return (
    <div className="admin-banner" data-testid="admin-mode-banner">
      <div>Admin Mode active · {formatAdminModeRemaining(adminMode)} remaining</div>
      <button
        type="button"
        data-testid="admin-mode-exit"
        onClick={() => {
          core.adminModeStore.exit();
        }}
      >
        Exit
      </button>
    </div>
  );
}

export function AdminModeGate({ children }: { children: ReactNode }) {
  const { core, requestEnter } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);

  if (isAdminModeActive(adminMode)) {
    return <>{children}</>;
  }

  return (
    <div className="admin-gate" data-testid="admin-mode-gate">
      <div className="alert error" role="alert">
        Enter Admin Mode to continue
      </div>
      <button
        type="button"
        data-testid="admin-mode-enter"
        onClick={() => {
          requestEnter();
        }}
      >
        Enter Admin Mode
      </button>
    </div>
  );
}

function AdminModeEnterDialog() {
  const { core, mode, closeEnter } = useAdminModeUiContext();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLTextAreaElement | null>(null);

  const issueDeviceToken = async (adminToken: string): Promise<void> => {
    const http = createTyrumHttpClient({
      baseUrl: core.httpBaseUrl,
      auth: { type: "bearer", token: adminToken },
      fetch: resolveHttpFetch(mode),
    });

    const issued = await http.deviceTokens.issue({
      device_id: "operator-ui",
      role: "client",
      scopes: ["operator.admin"],
      ttl_seconds: 60 * 10,
    });

    core.adminModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

  const submit = async (): Promise<void> => {
    if (busy) return;

    const confirmed = confirmRef.current?.checked ?? false;
    if (!confirmed) {
      setErrorMessage("Confirmation is required");
      return;
    }

    const adminToken = tokenRef.current?.value.trim() ?? "";
    if (!adminToken) {
      setErrorMessage("Admin token is required");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      await issueDeviceToken(adminToken);
      if (tokenRef.current) {
        tokenRef.current.value = "";
      }
      if (confirmRef.current) {
        confirmRef.current.checked = false;
      }
      closeEnter();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-dialog-backdrop" data-testid="admin-mode-dialog">
      <div className="admin-dialog card stack">
        <h1>Enter Admin Mode</h1>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Admin Mode enables dangerous operator actions. It is time-limited and can be exited at any
          time.
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="checkbox" data-testid="admin-mode-confirm" ref={confirmRef} />
          <span>I understand and want to proceed.</span>
        </label>

        <div>
          <label>
            Admin token
            <textarea
              data-testid="admin-mode-token"
              rows={3}
              ref={tokenRef}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            data-testid="admin-mode-submit"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? "Entering..." : "Enter Admin Mode"}
          </button>
          <button
            type="button"
            data-testid="admin-mode-cancel"
            disabled={busy}
            onClick={() => {
              setErrorMessage(null);
              if (confirmRef.current) {
                confirmRef.current.checked = false;
              }
              closeEnter();
            }}
          >
            Cancel
          </button>
        </div>

        {errorMessage ? (
          <div className="alert error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
