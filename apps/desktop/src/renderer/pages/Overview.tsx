import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import { colors, heading, card, label, value, badge, btn, statusDot, STATUS_COLORS } from "../theme.js";

interface StatusInfo {
  gatewayMode: string;
  gatewayStatus: string;
  port: number;
  capabilities: string[];
  uptime: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function Overview() {
  const [status, setStatus] = useState<StatusInfo>({
    gatewayMode: "embedded",
    gatewayStatus: "stopped",
    port: 0,
    capabilities: [],
    uptime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    // Load initial config
    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const mode = (c?.["mode"] as string) ?? "embedded";
      const embedded = c?.["embedded"] as Record<string, unknown> | undefined;
      const port =
        typeof embedded?.["port"] === "number" ? (embedded["port"] as number) : 8788;
      const capabilities: string[] = [];
      const caps = c?.["capabilities"] as Record<string, boolean> | undefined;
      if (caps) {
        for (const [k, v] of Object.entries(caps)) {
          if (v) capabilities.push(k);
        }
      }
      setStatus((prev) => ({ ...prev, gatewayMode: mode, capabilities, port }));
    });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        setStatus((prev) => ({
          ...prev,
          gatewayStatus: snapshot.status,
          port: snapshot.port,
        }));
        if (snapshot.status === "running" || snapshot.status === "stopped") {
          setGatewayError(null);
        }
      })
      .catch(() => {
        // Ignore snapshot failures; status events and user actions still drive UI updates.
      });

    const unsubscribe = api.onStatusChange((s) => {
      const info = s as Partial<StatusInfo>;
      if (
        info.gatewayStatus === "running" ||
        info.gatewayStatus === "stopped"
      ) {
        setGatewayError(null);
      }
      setStatus((prev) => ({ ...prev, ...info }));
    });
    return unsubscribe;
  }, []);

  const color = STATUS_COLORS[status.gatewayStatus] ?? colors.neutral;
  const api = window.tyrumDesktop;

  const startGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    setGatewayError(null);
    const port = status.port > 0 ? status.port : 8788;
    try {
      await api.setConfig({
        mode: "embedded",
        embedded: { port },
      });
      const result = await api.gateway.start();
      setStatus((prev) => ({
        ...prev,
        gatewayMode: "embedded",
        gatewayStatus: result.status,
        port: result.port,
      }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, gatewayStatus: "error" }));
      setGatewayError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const stopGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.gateway.stop();
      setStatus((prev) => ({ ...prev, gatewayStatus: result.status }));
      setGatewayError(null);
    } catch (error) {
      setGatewayError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={heading}>Overview</h1>

      <div style={card}>
        <div style={label}>Gateway Status</div>
        <div style={value}>
          <span style={statusDot(color)} />
          {status.gatewayStatus.charAt(0).toUpperCase() +
            status.gatewayStatus.slice(1)}
        </div>

        {(status.gatewayStatus === "stopped" || status.gatewayStatus === "error") && (
          <button style={{ ...btn("primary"), marginBottom: 14 }} onClick={startGateway} disabled={busy}>
            {busy ? "Starting..." : "Start Gateway"}
          </button>
        )}
        {(status.gatewayStatus === "running" || status.gatewayStatus === "starting") && (
          <button style={{ ...btn("danger"), marginBottom: 14 }} onClick={stopGateway} disabled={busy}>
            {busy ? "Stopping..." : "Stop Gateway"}
          </button>
        )}

        {gatewayError && (
          <div style={{ marginBottom: 16, color: colors.error, fontSize: 13 }}>
            Reason: {gatewayError}
          </div>
        )}

        <div style={label}>Mode</div>
        <div style={value}>
          {status.gatewayMode === "embedded"
            ? "Embedded Gateway"
            : "Remote Gateway"}
        </div>

        {status.port > 0 && (
          <>
            <div style={label}>Port</div>
            <div style={value}>{status.port}</div>
          </>
        )}

        {status.uptime > 0 && (
          <>
            <div style={label}>Uptime</div>
            <div style={value}>{formatUptime(status.uptime)}</div>
          </>
        )}
      </div>

      <div style={card}>
        <div style={label}>Connected Capabilities</div>
        <div style={{ marginTop: 8 }}>
          {status.capabilities.length === 0 ? (
            <span style={{ color: colors.neutral, fontSize: 14 }}>
              No capabilities enabled
            </span>
          ) : (
            status.capabilities.map((cap) => (
              <span key={cap} style={badge}>
                {cap}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
