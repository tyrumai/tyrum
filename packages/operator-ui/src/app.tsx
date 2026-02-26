import type { OperatorCore } from "@tyrum/operator-core";
import { useState, useSyncExternalStore } from "react";
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
  const title = mode === "web" ? "Login" : "Connect";
  return (
    <>
      <h1>{title}</h1>
      <div>
        <div>
          Status: <span>{connection.status}</span>
        </div>
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
              {run.run_id} ({run.status})
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
  return (
    <div className="tyrum-operator-ui">
      <style>{OPERATOR_UI_CSS}</style>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Tyrum</div>
          <nav className="nav">
            {NAV_ITEMS.map((item) => (
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
