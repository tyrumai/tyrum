import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";

interface StatusInfo {
  gatewayMode: string;
  gatewayStatus: string;
  port: number;
  capabilities: string[];
  uptime: number;
}

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  starting: "#eab308",
  error: "#ef4444",
  stopped: "#9ca3af",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  marginBottom: 16,
};

function statusDot(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    marginRight: 8,
    verticalAlign: "middle",
  };
}

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 12,
  background: "#e0e7ff",
  color: "#3730a3",
  fontSize: 12,
  fontWeight: 600,
  marginRight: 6,
  marginBottom: 6,
};

function btnStyle(variant: "primary" | "danger"): React.CSSProperties {
  const colors = {
    primary: { bg: "#6c63ff", color: "#fff" },
    danger: { bg: "#ef4444", color: "#fff" },
  };
  const c = colors[variant];
  return {
    padding: "8px 20px",
    borderRadius: 6,
    border: "none",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    background: c.bg,
    color: c.color,
    marginBottom: 14,
  };
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
        typeof embedded?.["port"] === "number" ? (embedded["port"] as number) : 8080;
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

  const color = STATUS_COLORS[status.gatewayStatus] ?? "#9ca3af";
  const api = window.tyrumDesktop;

  const startGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    setGatewayError(null);
    const port = status.port > 0 ? status.port : 8080;
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
      <h1 style={headingStyle}>Overview</h1>

      <div style={cardStyle}>
        <div style={labelStyle}>Gateway Status</div>
        <div style={valueStyle}>
          <span style={statusDot(color)} />
          {status.gatewayStatus.charAt(0).toUpperCase() +
            status.gatewayStatus.slice(1)}
        </div>

        {(status.gatewayStatus === "stopped" || status.gatewayStatus === "error") && (
          <button style={btnStyle("primary")} onClick={startGateway} disabled={busy}>
            {busy ? "Starting..." : "Start Gateway"}
          </button>
        )}
        {(status.gatewayStatus === "running" || status.gatewayStatus === "starting") && (
          <button style={btnStyle("danger")} onClick={stopGateway} disabled={busy}>
            {busy ? "Stopping..." : "Stop Gateway"}
          </button>
        )}

        {gatewayError && (
          <div style={{ marginBottom: 16, color: "#b91c1c", fontSize: 13 }}>
            Reason: {gatewayError}
          </div>
        )}

        <div style={labelStyle}>Mode</div>
        <div style={valueStyle}>
          {status.gatewayMode === "embedded"
            ? "Embedded Gateway"
            : "Remote Gateway"}
        </div>

        {status.port > 0 && (
          <>
            <div style={labelStyle}>Port</div>
            <div style={valueStyle}>{status.port}</div>
          </>
        )}

        {status.uptime > 0 && (
          <>
            <div style={labelStyle}>Uptime</div>
            <div style={valueStyle}>{formatUptime(status.uptime)}</div>
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>Connected Capabilities</div>
        <div style={{ marginTop: 8 }}>
          {status.capabilities.length === 0 ? (
            <span style={{ color: "#9ca3af", fontSize: 14 }}>
              No capabilities enabled
            </span>
          ) : (
            status.capabilities.map((cap) => (
              <span key={cap} style={badgeStyle}>
                {cap}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
