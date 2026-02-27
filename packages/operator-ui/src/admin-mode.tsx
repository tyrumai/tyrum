import { createTyrumHttpClient, type TyrumHttpFetch } from "@tyrum/client";
import { isAdminModeActive, type AdminModeState, type OperatorCore } from "@tyrum/operator-core";
import { createContext, useEffect, useContext, useRef, useState, type ReactNode } from "react";
import type { OperatorUiMode } from "./app.js";
import { getDesktopApi } from "./desktop-api.js";
import { useOperatorStore } from "./use-operator-store.js";

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
  const httpFetch = api?.gateway.httpFetch;
  if (!httpFetch) return undefined;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = headersToRecord(init?.headers);
    const result = await httpFetch({
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
  const [revealToken, setRevealToken] = useState(false);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);
  const titleId = "admin-mode-title";
  const descriptionId = "admin-mode-description";

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
      setRevealToken(false);
      closeEnter();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = (): void => {
    if (busy) return;
    setErrorMessage(null);
    setRevealToken(false);
    if (tokenRef.current) {
      tokenRef.current.value = "";
    }
    if (confirmRef.current) {
      confirmRef.current.checked = false;
    }
    closeEnter();
  };

  useEffect(() => {
    tokenRef.current?.focus();
  }, []);

  return (
    <div
      className="admin-dialog-backdrop"
      data-testid="admin-mode-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog();
        }
      }}
    >
      <div
        className="admin-dialog card stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h1 id={titleId}>Enter Admin Mode</h1>
        <div id={descriptionId} style={{ fontSize: 13, color: "var(--muted)" }}>
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
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                data-testid="admin-mode-token"
                ref={tokenRef}
                type={revealToken ? "text" : "password"}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                data-testid="admin-mode-token-toggle"
                disabled={busy}
                aria-pressed={revealToken}
                onClick={() => {
                  setRevealToken((prev) => !prev);
                }}
              >
                {revealToken ? "Hide" : "Show"}
              </button>
            </div>
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
              closeDialog();
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
