import type { OperatorCore } from "@tyrum/operator-core";
import { useRef, useState, useSyncExternalStore } from "react";
import { OPERATOR_UI_CSS } from "./style.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
}

type OperatorUiRouteId = "connect" | "dashboard" | "approvals" | "runs" | "pairing" | "settings";

const NAV_ITEMS: Array<{ id: OperatorUiRouteId; label: string }> = [
  { id: "connect", label: "Connect" },
  { id: "dashboard", label: "Dashboard" },
  { id: "approvals", label: "Approvals" },
  { id: "runs", label: "Runs" },
  { id: "pairing", label: "Pairing" },
  { id: "settings", label: "Settings" },
];

interface ExternalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}

function useOperatorStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
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
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.toLowerCase().includes("application/json")) {
        const body = (await res.json()) as unknown;
        if (body && typeof body === "object" && !Array.isArray(body)) {
          const message = (body as Record<string, unknown>)["message"];
          if (typeof message === "string" && message.trim()) return message;
        }
      }
    } catch {
      // ignore
    }

    try {
      const text = (await res.text()).trim();
      if (text) return truncateText(text);
    } catch {
      // ignore
    }

    return `HTTP ${String(res.status)}`;
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
  const navItems =
    mode === "web"
      ? NAV_ITEMS.map((item) => (item.id === "connect" ? { ...item, label: "Login" } : item))
      : NAV_ITEMS;
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
          </nav>
        </aside>
        <main className="main">
          {route === "connect" && <ConnectPage core={core} mode={mode} />}
          {route === "dashboard" && <DashboardPage core={core} />}
          {route === "approvals" && <ApprovalsPage core={core} />}
          {route === "runs" && <RunsPage core={core} />}
          {route === "pairing" && <PairingPage core={core} />}
          {route === "settings" && <SettingsPage core={core} mode={mode} />}
        </main>
      </div>
    </div>
  );
}
