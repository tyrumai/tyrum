import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OPERATOR_UI_CSS } from "./style.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
}

type OperatorUiRouteId =
  | "connect"
  | "dashboard"
  | "approvals"
  | "runs"
  | "pairing"
  | "settings"
  | "desktop";

const NAV_ITEMS: Array<{ id: OperatorUiRouteId; label: string }> = [
  { id: "connect", label: "Connect" },
  { id: "dashboard", label: "Dashboard" },
  { id: "approvals", label: "Approvals" },
  { id: "runs", label: "Runs" },
  { id: "pairing", label: "Pairing" },
  { id: "settings", label: "Settings" },
];

const DESKTOP_NAV_ITEMS: Array<{ id: OperatorUiRouteId; label: string }> = [
  { id: "desktop", label: "Desktop" },
];

interface ExternalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}

function useOperatorStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

type DesktopApi = {
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<unknown>;
  gateway: {
    getStatus: () => Promise<{ status: string; port: number }>;
    start: () => Promise<{ status: string; port: number }>;
    stop: () => Promise<{ status: string }>;
  };
  node: {
    connect: () => Promise<{ status: string }>;
    disconnect: () => Promise<{ status: string }>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  checkMacPermissions?: () => Promise<unknown>;
  requestMacPermission?: (permission: "accessibility" | "screenRecording") => Promise<unknown>;
};

function getDesktopApi(): DesktopApi | null {
  const api = (globalThis as unknown as { window?: unknown }).window as
    | { tyrumDesktop?: unknown }
    | undefined;
  if (!api?.tyrumDesktop) return null;
  return api.tyrumDesktop as DesktopApi;
}

function ConnectPage({ core, mode }: { core: OperatorCore; mode: OperatorUiMode }) {
  const connection = useOperatorStore(core.connectionStore);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLTextAreaElement | null>(null);
  const title = mode === "web" ? "Login" : "Connect";
  const isWeb = mode === "web";

  const truncateText = (text: string, limit = 300): string => {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}…`;
  };

  const readGatewayError = async (res: Response): Promise<string> => {
    const contentType = res.headers.get("content-type")?.trim().toLowerCase() ?? "";
    const maybeJson =
      contentType.includes("application/json") ||
      contentType.includes("+json") ||
      contentType.includes("/json");

    let bodyText: string;
    try {
      bodyText = await res.text();
    } catch {
      return `HTTP ${String(res.status)}`;
    }

    const trimmedText = bodyText.trim();
    if (!trimmedText) {
      return `HTTP ${String(res.status)}`;
    }

    if (maybeJson) {
      try {
        const body = JSON.parse(trimmedText) as unknown;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const message = (body as Record<string, unknown>)["message"];
          if (typeof message === "string" && message.trim()) {
            return message.trim();
          }

          const error = (body as Record<string, unknown>)["error"];
          if (typeof error === "string" && error.trim()) {
            return error.trim();
          }
        }
      } catch {
        // ignore
      }
    }

    return truncateText(trimmedText);
  };

  const login = async (): Promise<void> => {
    if (!isWeb) return;
    const trimmed = tokenRef.current?.value.trim() ?? "";
    if (!trimmed) {
      setLoginError("Token is required");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await fetch("/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: trimmed }),
      });
      if (!res.ok) {
        setLoginError(await readGatewayError(res));
        return;
      }
      if (tokenRef.current) {
        tokenRef.current.value = "";
      }
      core.connect();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusy(false);
    }
  };
  return (
    <>
      <h1>{title}</h1>
      <div className="stack">
        {isWeb ? (
          <div className="card stack">
            <div>
              <label>
                Token
                <textarea
                  data-testid="login-token"
                  rows={3}
                  ref={tokenRef}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="login-button"
              disabled={loginBusy}
              onClick={() => {
                void login();
              }}
            >
              {loginBusy ? "Logging in..." : "Login"}
            </button>
            {loginError ? (
              <div className="alert error" role="alert">
                {loginError}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="card stack">
          <div>
            Status: <span>{connection.status}</span>
          </div>
          {connection.transportError ? (
            <div className="alert error" role="alert">
              Transport error: {connection.transportError}
            </div>
          ) : null}
          {connection.lastDisconnect ? (
            <div className="alert error" role="alert">
              Last disconnect: {connection.lastDisconnect.code} {connection.lastDisconnect.reason}
            </div>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="connect-button"
              onClick={() => {
                core.connect();
              }}
            >
              Connect
            </button>
            <button
              type="button"
              data-testid="disconnect-button"
              onClick={() => {
                core.disconnect();
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DesktopSetupPage({ core }: { core: OperatorCore }) {
  const api = getDesktopApi();
  const [port, setPort] = useState(8788);
  const [mode, setMode] = useState<"embedded" | "remote">("embedded");
  const [gatewayStatus, setGatewayStatus] = useState("unknown");
  const [nodeStatus, setNodeStatus] = useState("disconnected");
  const [busy, setBusy] = useState<"gateway" | "node" | "config" | null>(null);
  const [requestingPermission, setRequestingPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const saveResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [capabilities, setCapabilities] = useState<{
    desktop: boolean;
    playwright: boolean;
    cli: boolean;
    http: boolean;
  }>({
    desktop: true,
    playwright: false,
    cli: false,
    http: false,
  });
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [macPermissionSummary, setMacPermissionSummary] = useState<string | null>(null);

  const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error);
  };

  useEffect(() => {
    return () => {
      if (saveResetTimer.current) {
        clearTimeout(saveResetTimer.current);
        saveResetTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    let disposed = false;

    void api
      .getConfig()
      .then((cfg) => {
        if (disposed) return;
        const c = cfg as Record<string, unknown>;
        if (c["mode"] === "embedded" || c["mode"] === "remote") {
          setMode(c["mode"] as "embedded" | "remote");
        }
        const embedded = c["embedded"] as Record<string, unknown> | undefined;
        if (embedded && typeof embedded["port"] === "number") {
          setPort(embedded["port"] as number);
        }
        const caps = c["capabilities"] as Record<string, unknown> | undefined;
        if (caps) {
          setCapabilities({
            desktop: caps["desktop"] !== false,
            playwright: caps["playwright"] === true,
            cli: caps["cli"] === true,
            http: caps["http"] === true,
          });
        }
      })
      .catch(() => {
        // ignore; desktop page actions still work without config snapshot
      });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        if (disposed) return;
        setGatewayStatus(snapshot.status);
        if (typeof snapshot.port === "number" && snapshot.port > 0) {
          setPort(snapshot.port);
        }
      })
      .catch(() => {
        // ignore; live status events and user actions still update UI
      });

    const unsubscribe = api.onStatusChange((status) => {
      if (disposed) return;
      if (!status || typeof status !== "object" || Array.isArray(status)) return;
      const s = status as Record<string, unknown>;
      if (typeof s["gatewayStatus"] === "string") {
        setGatewayStatus(s["gatewayStatus"] as string);
      }
      if (typeof s["nodeStatus"] === "string") {
        setNodeStatus(s["nodeStatus"] as string);
      }
      if (typeof s["port"] === "number") {
        setPort(s["port"] as number);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);

  const startGateway = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy("gateway");
    setErrorMessage(null);
    try {
      const result = await api.gateway.start();
      setGatewayStatus(result.status);
      setPort(result.port);
      core.connect();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const stopGateway = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy("gateway");
    setErrorMessage(null);
    try {
      const result = await api.gateway.stop();
      setGatewayStatus(result.status);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const connectNode = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy("node");
    setErrorMessage(null);
    try {
      const result = await api.node.connect();
      setNodeStatus(result.status);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const disconnectNode = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy("node");
    setErrorMessage(null);
    try {
      const result = await api.node.disconnect();
      setNodeStatus(result.status);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const toggleCapability = (key: keyof typeof capabilities): void => {
    if (saveResetTimer.current) {
      clearTimeout(saveResetTimer.current);
      saveResetTimer.current = null;
    }
    setConfigSaved(false);
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
    setConfigDirty(true);
  };

  const saveConfig = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy("config");
    setErrorMessage(null);
    setConfigSaved(false);
    try {
      await api.setConfig({ capabilities });
      setConfigDirty(false);
      setConfigSaved(true);
      if (saveResetTimer.current) {
        clearTimeout(saveResetTimer.current);
      }
      saveResetTimer.current = setTimeout(() => {
        setConfigSaved(false);
        saveResetTimer.current = null;
      }, 1500);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const checkMacPermissions = async (): Promise<void> => {
    if (!api?.checkMacPermissions) return;
    setErrorMessage(null);
    try {
      const snapshot = (await api.checkMacPermissions()) as {
        accessibility: boolean | null;
        screenRecording: boolean | null;
        instructions?: string;
      } | null;
      if (!snapshot) {
        setMacPermissionSummary("Not macOS (skipped).");
      } else {
        const missing = [
          snapshot.accessibility === true ? null : "Accessibility",
          snapshot.screenRecording === true ? null : "Screen Recording",
        ].filter(Boolean);
        if (missing.length === 0) {
          setMacPermissionSummary("All macOS permissions granted.");
        } else {
          const instructions =
            typeof snapshot.instructions === "string" && snapshot.instructions.trim()
              ? ` ${snapshot.instructions.trim()}`
              : "";
          setMacPermissionSummary(`Missing: ${missing.join(", ")}.${instructions}`);
        }
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  };

  const requestMacPermission = async (permission: "accessibility" | "screenRecording") => {
    if (!api?.requestMacPermission || busy || requestingPermission) return;
    setRequestingPermission(permission);
    setErrorMessage(null);
    try {
      await api.requestMacPermission(permission);
      void checkMacPermissions();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setRequestingPermission(null);
    }
  };

  if (!api) {
    return (
      <>
        <h1>Desktop Setup</h1>
        <div className="alert error" role="alert">
          Desktop API not available.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Desktop Setup</h1>
      <div className="stack">
        <div className="card stack">
          <div>
            Embedded gateway: <span>{gatewayStatus}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Operator mode: {mode === "embedded" ? "embedded (local)" : "remote"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Port: {port}</div>
          <div>
            {gatewayStatus === "running" ? (
              <button
                type="button"
                data-testid="desktop-stop-gateway"
                disabled={busy !== null}
                onClick={() => {
                  void stopGateway();
                }}
              >
                {busy === "gateway" ? "Stopping..." : "Stop gateway"}
              </button>
            ) : (
              <button
                type="button"
                data-testid="desktop-start-gateway"
                disabled={busy !== null}
                onClick={() => {
                  void startGateway();
                }}
              >
                {busy === "gateway" ? "Starting..." : "Start gateway"}
              </button>
            )}
          </div>
        </div>

        <div className="card stack">
          <div>
            Local node runtime: <span>{nodeStatus}</span>
          </div>
          <div>
            {nodeStatus === "connected" || nodeStatus === "connecting" ? (
              <button
                type="button"
                data-testid="desktop-disconnect-node"
                disabled={busy !== null}
                onClick={() => {
                  void disconnectNode();
                }}
              >
                {busy === "node"
                  ? "Disconnecting..."
                  : nodeStatus === "connecting"
                    ? "Cancel connect"
                    : "Disconnect node"}
              </button>
            ) : (
              <button
                type="button"
                data-testid="desktop-connect-node"
                disabled={busy !== null}
                onClick={() => {
                  void connectNode();
                }}
              >
                {busy === "node" ? "Connecting..." : "Connect node"}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Reconnect the node runtime after changing capabilities.
          </div>
        </div>

        <div className="card stack">
          <div style={{ fontSize: 14, fontWeight: 700 }}>Capabilities</div>
          {(
            [
              ["desktop", "Desktop (screenshot & input)"],
              ["playwright", "Playwright (web automation)"],
              ["cli", "CLI (command execution)"],
              ["http", "HTTP (network requests)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={capabilities[key]}
                disabled={busy === "config"}
                onChange={() => toggleCapability(key)}
              />
              <span>{label}</span>
            </label>
          ))}
          {capabilities.cli || capabilities.http ? (
            <div className="alert" role="note">
              CLI/HTTP capabilities can execute commands or make network requests from this machine.
              Keep them disabled unless you explicitly need them.
            </div>
          ) : null}
          <div>
            <button
              type="button"
              data-testid="desktop-save-capabilities"
              disabled={!configDirty || busy !== null}
              onClick={() => {
                void saveConfig();
              }}
            >
              {busy === "config" ? "Saving..." : configSaved ? "Saved" : "Save settings"}
            </button>
          </div>
        </div>

        <div className="card stack">
          <div style={{ fontSize: 14, fontWeight: 700 }}>macOS permissions</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Desktop automation may require Accessibility and Screen Recording permissions on macOS.
          </div>
          <div>
            <button
              type="button"
              data-testid="desktop-check-mac-permissions"
              disabled={!api.checkMacPermissions || requestingPermission !== null || busy !== null}
              onClick={() => {
                void checkMacPermissions();
              }}
            >
              Check permissions
            </button>
          </div>
          {macPermissionSummary ? <div>{macPermissionSummary}</div> : null}
          <div>
            <button
              type="button"
              data-testid="desktop-request-accessibility"
              disabled={!api.requestMacPermission || requestingPermission !== null || busy !== null}
              onClick={() => {
                void requestMacPermission("accessibility");
              }}
            >
              {requestingPermission === "accessibility" ? "Requesting..." : "Request Accessibility"}
            </button>
            <button
              type="button"
              data-testid="desktop-request-screen-recording"
              disabled={!api.requestMacPermission || requestingPermission !== null || busy !== null}
              onClick={() => {
                void requestMacPermission("screenRecording");
              }}
              style={{ marginLeft: 8 }}
            >
              {requestingPermission === "screenRecording"
                ? "Opening..."
                : "Request Screen Recording"}
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div className="alert error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </div>
    </>
  );
}

function DashboardPage({ core }: { core: OperatorCore }) {
  const statusState = useOperatorStore(core.statusStore);
  return (
    <>
      <h1>Dashboard</h1>
      <button
        type="button"
        data-testid="dashboard-refresh-status"
        onClick={() => {
          void core.statusStore.refreshStatus();
        }}
      >
        Refresh status
      </button>
      <div>Instance: {statusState.status?.instance_id ?? "-"}</div>
    </>
  );
}

function ApprovalsPage({ core }: { core: OperatorCore }) {
  const approvals = useOperatorStore(core.approvalsStore);
  return (
    <>
      <h1>Approvals</h1>
      <button
        type="button"
        data-testid="approvals-refresh"
        onClick={() => {
          void core.approvalsStore.refreshPending();
        }}
      >
        Refresh
      </button>
      {approvals.pendingIds.length === 0 ? (
        <div>No pending approvals.</div>
      ) : (
        <ul>
          {approvals.pendingIds.map((approvalId) => {
            const approval = approvals.byId[approvalId];
            if (!approval) return null;
            return (
              <li key={approvalId}>
                <div>{approval.prompt}</div>
                <button
                  type="button"
                  data-testid={`approval-approve-${approvalId}`}
                  onClick={() => {
                    void core.approvalsStore.resolve(approvalId, "approved");
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  data-testid={`approval-deny-${approvalId}`}
                  onClick={() => {
                    void core.approvalsStore.resolve(approvalId, "denied");
                  }}
                >
                  Deny
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function PairingPage({ core }: { core: OperatorCore }) {
  const pairing = useOperatorStore(core.pairingStore);
  return (
    <>
      <h1>Pairing</h1>
      <button
        type="button"
        data-testid="pairing-refresh"
        onClick={() => {
          void core.pairingStore.refresh();
        }}
      >
        Refresh
      </button>
      {pairing.pendingIds.length === 0 ? (
        <div>No pending pairing requests.</div>
      ) : (
        <ul>
          {pairing.pendingIds.map((pairingId) => {
            const req = pairing.byId[pairingId];
            if (!req) return null;
            return (
              <li key={pairingId}>
                <div>{req.node.node_id}</div>
                <button
                  type="button"
                  data-testid={`pairing-approve-${pairingId}`}
                  onClick={() => {
                    void core.pairingStore.approve(pairingId, {
                      trust_level: "local",
                      capability_allowlist: req.capability_allowlist,
                    });
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  data-testid={`pairing-deny-${pairingId}`}
                  onClick={() => {
                    void core.pairingStore.deny(pairingId);
                  }}
                >
                  Deny
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function RunsPage({ core }: { core: OperatorCore }) {
  const runsState = useOperatorStore(core.runsStore);
  const runs = Object.values(runsState.runsById);
  return (
    <>
      <h1>Runs</h1>
      {runs.length === 0 ? (
        <div>No runs yet</div>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.run_id}>
              <div>
                {run.run_id} ({run.status})
              </div>
              <ul>
                {(runsState.stepIdsByRunId[run.run_id] ?? [])
                  .map((stepId) => runsState.stepsById[stepId])
                  .filter((step) => step !== undefined)
                  .sort((a, b) => a.step_index - b.step_index)
                  .map((step) => (
                    <li key={step.step_id}>
                      <div>
                        Step {step.step_index}: {step.action.type} ({step.status})
                      </div>
                      <div>{step.step_id}</div>
                      <ul>
                        {(runsState.attemptIdsByStepId[step.step_id] ?? [])
                          .map((attemptId) => runsState.attemptsById[attemptId])
                          .filter((attempt) => attempt !== undefined)
                          .sort((a, b) => a.attempt - b.attempt)
                          .map((attempt) => (
                            <li key={attempt.attempt_id}>
                              <div>
                                Attempt {attempt.attempt}: {attempt.status}
                              </div>
                              <div>{attempt.attempt_id}</div>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SettingsPage({ core, mode }: { core: OperatorCore; mode: OperatorUiMode }) {
  const statusState = useOperatorStore(core.statusStore);
  const totalTokens = statusState.usage?.local.totals.total_tokens;
  return (
    <>
      <h1>Settings</h1>
      <div>Mode: {mode}</div>
      <button
        type="button"
        data-testid="settings-refresh-usage"
        onClick={() => {
          void core.statusStore.refreshUsage();
        }}
      >
        Refresh usage
      </button>
      <div>Total tokens: {totalTokens ?? "-"}</div>
    </>
  );
}

export function OperatorUiApp({ core, mode }: OperatorUiAppProps) {
  const [route, setRoute] = useState<OperatorUiRouteId>("connect");
  const navItems = NAV_ITEMS.map((item) => {
    if (mode === "web" && item.id === "connect") return { ...item, label: "Login" };
    return item;
  });
  const desktopNavItems = mode === "desktop" ? DESKTOP_NAV_ITEMS : [];
  return (
    <div className="tyrum-operator-ui">
      <style>{OPERATOR_UI_CSS}</style>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Tyrum</div>
          <nav className="nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                className={route === item.id ? "active" : undefined}
                onClick={() => {
                  setRoute(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
            {desktopNavItems.length > 0 ? (
              <>
                <div
                  style={{
                    margin: "10px 16px 6px",
                    fontSize: 12,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    color: "var(--muted)",
                  }}
                >
                  Desktop
                </div>
                {desktopNavItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`nav-${item.id}`}
                    className={route === item.id ? "active" : undefined}
                    onClick={() => {
                      setRoute(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </>
            ) : null}
          </nav>
        </aside>
        <main className="main">
          {route === "connect" && <ConnectPage core={core} mode={mode} />}
          {route === "dashboard" && <DashboardPage core={core} />}
          {route === "approvals" && <ApprovalsPage core={core} />}
          {route === "runs" && <RunsPage core={core} />}
          {route === "pairing" && <PairingPage core={core} />}
          {route === "settings" && <SettingsPage core={core} mode={mode} />}
          {route === "desktop" && mode === "desktop" && <DesktopSetupPage core={core} />}
        </main>
      </div>
    </div>
  );
}
