import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Database,
  LayoutDashboard,
  Link2,
  LogIn,
  Monitor,
  Play,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { AdminModeGate, AdminModeProvider } from "./admin-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar } from "./components/layout/sidebar.js";
import { MemoryInspector } from "./components/memory/memory-inspector.js";
import { ToastProvider } from "./components/toast/toast-provider.js";
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent } from "./components/ui/card.js";
import { getDesktopApi } from "./desktop-api.js";
import { ThemeProvider } from "./hooks/use-theme.js";
import { ApprovalsPage } from "./pages/approvals-page.js";
import { ConnectPage } from "./pages/connect-page.js";
import { useOperatorStore } from "./use-operator-store.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
}

type OperatorUiRouteId =
  | "connect"
  | "dashboard"
  | "memory"
  | "approvals"
  | "runs"
  | "pairing"
  | "settings"
  | "desktop";

type NavIcon = ComponentType<{ className?: string }>;

const NAV_ITEM_CONFIG: Record<OperatorUiRouteId, { label: string; icon: NavIcon }> = {
  connect: { label: "Connect", icon: LogIn },
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
  memory: { label: "Memory", icon: Database },
  approvals: { label: "Approvals", icon: ShieldCheck },
  runs: { label: "Runs", icon: Play },
  pairing: { label: "Pairing", icon: Link2 },
  settings: { label: "Settings", icon: Settings },
  desktop: { label: "Desktop", icon: Monitor },
};

const SIDEBAR_NAV_ORDER: OperatorUiRouteId[] = [
  "connect",
  "dashboard",
  "memory",
  "approvals",
  "runs",
  "pairing",
  "settings",
];

const MOBILE_NAV_ORDER: OperatorUiRouteId[] = ["dashboard", "approvals", "runs", "settings"];
const MOBILE_OVERFLOW_NAV_ORDER: OperatorUiRouteId[] = ["memory", "pairing", "connect"];
const DESKTOP_NAV_ORDER: OperatorUiRouteId[] = ["desktop"];

function isOperatorUiRouteId(value: string): value is OperatorUiRouteId {
  return Object.prototype.hasOwnProperty.call(NAV_ITEM_CONFIG, value);
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
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Desktop Setup</h1>
        <Alert variant="error" title="Desktop API not available." />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Desktop Setup</h1>
      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="text-sm">
              <span className="text-fg-muted">Embedded gateway:</span>{" "}
              <span className="font-medium text-fg">{gatewayStatus}</span>
            </div>
            <div className="text-xs text-fg-muted">
              Operator mode: {mode === "embedded" ? "embedded (local)" : "remote"}
            </div>
            <div className="text-xs text-fg-muted">Port: {port}</div>
            <div>
              {gatewayStatus === "running" ? (
                <Button
                  data-testid="desktop-stop-gateway"
                  variant="danger"
                  disabled={busy !== null}
                  isLoading={busy === "gateway"}
                  onClick={() => {
                    void stopGateway();
                  }}
                >
                  {busy === "gateway" ? "Stopping..." : "Stop gateway"}
                </Button>
              ) : (
                <Button
                  data-testid="desktop-start-gateway"
                  disabled={busy !== null}
                  isLoading={busy === "gateway"}
                  onClick={() => {
                    void startGateway();
                  }}
                >
                  {busy === "gateway" ? "Starting..." : "Start gateway"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="text-sm">
              <span className="text-fg-muted">Local node runtime:</span>{" "}
              <span className="font-medium text-fg">{nodeStatus}</span>
            </div>
            <div>
              {nodeStatus === "connected" || nodeStatus === "connecting" ? (
                <Button
                  data-testid="desktop-disconnect-node"
                  variant="secondary"
                  disabled={busy !== null}
                  isLoading={busy === "node"}
                  onClick={() => {
                    void disconnectNode();
                  }}
                >
                  {busy === "node"
                    ? "Disconnecting..."
                    : nodeStatus === "connecting"
                      ? "Cancel connect"
                      : "Disconnect node"}
                </Button>
              ) : (
                <Button
                  data-testid="desktop-connect-node"
                  variant="secondary"
                  disabled={busy !== null}
                  isLoading={busy === "node"}
                  onClick={() => {
                    void connectNode();
                  }}
                >
                  {busy === "node" ? "Connecting..." : "Connect node"}
                </Button>
              )}
            </div>
            <div className="text-xs text-fg-muted">
              Reconnect the node runtime after changing capabilities.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="text-sm font-semibold text-fg">Capabilities</div>
            {(
              [
                ["desktop", "Desktop (screenshot & input)"],
                ["playwright", "Playwright (web automation)"],
                ["cli", "CLI (command execution)"],
                ["http", "HTTP (network requests)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-fg">
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
              <Alert
                variant="warning"
                title="Security note"
                description="CLI/HTTP capabilities can execute commands or make network requests from this machine. Keep them disabled unless you explicitly need them."
              />
            ) : null}
            <div>
              <Button
                data-testid="desktop-save-capabilities"
                variant="secondary"
                disabled={!configDirty || busy !== null}
                isLoading={busy === "config"}
                onClick={() => {
                  void saveConfig();
                }}
              >
                {busy === "config" ? "Saving..." : configSaved ? "Saved" : "Save settings"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="text-sm font-semibold text-fg">macOS permissions</div>
            <div className="text-xs text-fg-muted">
              Desktop automation may require Accessibility and Screen Recording permissions on
              macOS.
            </div>
            <div>
              <Button
                data-testid="desktop-check-mac-permissions"
                variant="secondary"
                disabled={
                  !api.checkMacPermissions || requestingPermission !== null || busy !== null
                }
                onClick={() => {
                  void checkMacPermissions();
                }}
              >
                Check permissions
              </Button>
            </div>
            {macPermissionSummary ? (
              <div className="text-sm text-fg">{macPermissionSummary}</div>
            ) : null}
            <div>
              <Button
                data-testid="desktop-request-accessibility"
                variant="secondary"
                disabled={
                  !api.requestMacPermission || requestingPermission !== null || busy !== null
                }
                onClick={() => {
                  void requestMacPermission("accessibility");
                }}
              >
                {requestingPermission === "accessibility"
                  ? "Requesting..."
                  : "Request Accessibility"}
              </Button>
              <Button
                data-testid="desktop-request-screen-recording"
                variant="secondary"
                disabled={
                  !api.requestMacPermission || requestingPermission !== null || busy !== null
                }
                onClick={() => {
                  void requestMacPermission("screenRecording");
                }}
                className="ml-2"
              >
                {requestingPermission === "screenRecording"
                  ? "Opening..."
                  : "Request Screen Recording"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {errorMessage ? <Alert variant="error" title="Error" description={errorMessage} /> : null}
      </div>
    </div>
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
  const [adminCommandBusy, setAdminCommandBusy] = useState(false);
  const [adminCommandError, setAdminCommandError] = useState<string | null>(null);

  const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return String(error);
  };

  const runAdminCommand = async (): Promise<void> => {
    if (adminCommandBusy) return;

    setAdminCommandBusy(true);
    setAdminCommandError(null);

    try {
      if (!core.ws.commandExecute) {
        setAdminCommandError("Admin commands are not supported by this client.");
        return;
      }
      await core.ws.commandExecute("/help");
    } catch (error) {
      setAdminCommandError(toErrorMessage(error));
    } finally {
      setAdminCommandBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Settings</h1>
      <div className="grid gap-2">
        <div className="text-sm text-fg-muted">Mode: {mode}</div>
        <Button
          data-testid="settings-refresh-usage"
          variant="secondary"
          onClick={() => {
            void core.statusStore.refreshUsage();
          }}
        >
          Refresh usage
        </Button>
        <div className="text-sm text-fg">Total tokens: {totalTokens ?? "-"}</div>
      </div>

      <h2 className="mt-6 text-lg font-semibold text-fg">Admin</h2>
      <AdminModeGate>
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="text-sm text-fg-muted">
              Admin Mode is required for privileged operator actions.
            </div>
            <Button
              data-testid="settings-admin-command-execute"
              variant="secondary"
              isLoading={adminCommandBusy}
              onClick={() => {
                void runAdminCommand();
              }}
            >
              {adminCommandBusy ? "Running..." : "Run admin command"}
            </Button>
            {adminCommandError ? (
              <Alert variant="error" title="Admin command failed" description={adminCommandError} />
            ) : null}
          </CardContent>
        </Card>
      </AdminModeGate>
    </div>
  );
}

export function OperatorUiApp({ core, mode }: OperatorUiAppProps) {
  const [route, setRoute] = useState<OperatorUiRouteId>("connect");
  const connection = useOperatorStore(core.connectionStore);

  const resolveLabel = (id: OperatorUiRouteId): string => {
    if (mode === "web" && id === "connect") return "Login";
    return NAV_ITEM_CONFIG[id].label;
  };

  const toNavItem = (id: OperatorUiRouteId) => ({
    id,
    label: resolveLabel(id),
    icon: NAV_ITEM_CONFIG[id].icon,
    testId: `nav-${id}`,
  });

  const sidebarItems = SIDEBAR_NAV_ORDER.map(toNavItem);
  const desktopItems = mode === "desktop" ? DESKTOP_NAV_ORDER.map(toNavItem) : [];
  const mobileItems = MOBILE_NAV_ORDER.map(toNavItem);
  const mobileOverflowItems = MOBILE_OVERFLOW_NAV_ORDER.map(toNavItem);

  const navigate = (id: string): void => {
    if (!isOperatorUiRouteId(id)) return;
    setRoute(id);
  };

  return (
    <ThemeProvider>
      <ToastProvider>
        <ErrorBoundary>
          <AppShell
            mode={mode}
            sidebar={
              <Sidebar
                items={sidebarItems}
                secondaryItems={desktopItems}
                activeItemId={route}
                onNavigate={navigate}
                connectionStatus={connection.status}
              />
            }
            mobileNav={
              <MobileNav
                items={mobileItems}
                overflowItems={mobileOverflowItems}
                activeItemId={route}
                onNavigate={navigate}
              />
            }
          >
            <AdminModeProvider core={core} mode={mode}>
              {route === "connect" && <ConnectPage core={core} mode={mode} />}
              {route === "dashboard" && <DashboardPage core={core} />}
              {route === "memory" && <MemoryInspector core={core} />}
              {route === "approvals" && <ApprovalsPage core={core} />}
              {route === "runs" && <RunsPage core={core} />}
              {route === "pairing" && <PairingPage core={core} />}
              {route === "settings" && <SettingsPage core={core} mode={mode} />}
              {route === "desktop" && mode === "desktop" && <DesktopSetupPage core={core} />}
            </AdminModeProvider>
          </AppShell>
        </ErrorBoundary>
      </ToastProvider>
    </ThemeProvider>
  );
}
