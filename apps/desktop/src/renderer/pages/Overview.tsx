import { useEffect, useState } from "react";

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

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    // Load initial config
    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const mode = (c?.["mode"] as string) ?? "embedded";
      const capabilities: string[] = [];
      const caps = c?.["capabilities"] as Record<string, boolean> | undefined;
      if (caps) {
        for (const [k, v] of Object.entries(caps)) {
          if (v) capabilities.push(k);
        }
      }
      setStatus((prev) => ({ ...prev, gatewayMode: mode, capabilities }));
    });

    const unsubscribe = api.onStatusChange((s) => {
      const info = s as Partial<StatusInfo>;
      setStatus((prev) => ({ ...prev, ...info }));
    });
    return unsubscribe;
  }, []);

  const color = STATUS_COLORS[status.gatewayStatus] ?? "#9ca3af";

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
