import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";

type Tab = "embedded" | "remote";

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

const tabRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  marginBottom: 16,
  borderBottom: "2px solid #e5e7eb",
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? "#6c63ff" : "#6b7280",
    borderBottom: active ? "2px solid #6c63ff" : "2px solid transparent",
    marginBottom: -2,
    background: "none",
    border: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: active ? "#6c63ff" : "transparent",
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
  marginTop: 12,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function btnStyle(variant: "primary" | "danger" | "secondary"): React.CSSProperties {
  const colors = {
    primary: { bg: "#6c63ff", color: "#fff" },
    danger: { bg: "#ef4444", color: "#fff" },
    secondary: { bg: "#e5e7eb", color: "#374151" },
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
    marginRight: 8,
    marginTop: 12,
  };
}

const infoStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  marginTop: 8,
};

export function Connection() {
  const [tab, setTab] = useState<Tab>("embedded");
  const [mode, setMode] = useState<string>("embedded");
  const [port, setPort] = useState(8788);
  const [gatewayStatus, setGatewayStatus] = useState("stopped");
  const [remoteUrl, setRemoteUrl] = useState("ws://127.0.0.1:8788/ws");
  const [remoteToken, setRemoteToken] = useState("");
  const [hasSavedRemoteToken, setHasSavedRemoteToken] = useState(false);
  const [nodeStatus, setNodeStatus] = useState("disconnected");
  const [busy, setBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const m = (c?.["mode"] as string) ?? "embedded";
      setMode(m);
      setTab(m === "remote" ? "remote" : "embedded");

      const embedded = c?.["embedded"] as Record<string, unknown> | undefined;
      if (embedded?.["port"]) setPort(embedded["port"] as number);

      const remote = c?.["remote"] as Record<string, unknown> | undefined;
      if (remote?.["wsUrl"]) setRemoteUrl(remote["wsUrl"] as string);
      if (remote?.["tokenRef"]) setHasSavedRemoteToken(true);
    });

    void api.gateway
      .getStatus()
      .then((snapshot) => {
        setGatewayStatus(snapshot.status);
        setPort(snapshot.port);
        if (snapshot.status === "running" || snapshot.status === "stopped") {
          setGatewayError(null);
        }
      })
      .catch(() => {
        // Ignore snapshot failures; live status events and actions still update the view.
      });

    const unsubscribe = api.onStatusChange((s) => {
      const info = s as Record<string, unknown>;
      if (info["gatewayStatus"]) {
        const nextGatewayStatus = info["gatewayStatus"] as string;
        setGatewayStatus(nextGatewayStatus);
        if (nextGatewayStatus === "running" || nextGatewayStatus === "stopped") {
          setGatewayError(null);
        }
      }
      if (info["nodeStatus"]) setNodeStatus(info["nodeStatus"] as string);
      if (info["port"]) setPort(info["port"] as number);
    });
    return unsubscribe;
  }, []);

  const api = window.tyrumDesktop;

  const startGateway = async () => {
    if (!api || busy) return;
    setBusy(true);
    setGatewayError(null);
    try {
      await api.setConfig({
        mode: "embedded",
        embedded: { port },
      });
      const result = await api.gateway.start();
      setGatewayStatus(result.status);
      setPort(result.port);
    } catch (error) {
      setGatewayStatus("error");
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
      setGatewayStatus(result.status);
      setGatewayError(null);
    } finally {
      setBusy(false);
    }
  };

  const connectNode = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const trimmedToken = remoteToken.trim();
      const remoteConfig: Record<string, unknown> = { wsUrl: remoteUrl };
      if (trimmedToken.length > 0) {
        remoteConfig["tokenRef"] = trimmedToken;
        setHasSavedRemoteToken(true);
      }

      await api.setConfig({ mode: "remote", remote: remoteConfig });
      const result = await api.node.connect();
      setNodeStatus(result.status);
    } finally {
      setBusy(false);
    }
  };

  const disconnectNode = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.node.disconnect();
      setNodeStatus(result.status);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={headingStyle}>Connection</h1>

      <div style={tabRowStyle}>
        <button style={tabStyle(tab === "embedded")} onClick={() => setTab("embedded")}>
          Embedded
        </button>
        <button style={tabStyle(tab === "remote")} onClick={() => setTab("remote")}>
          Remote
        </button>
      </div>

      {tab === "embedded" && (
        <div style={cardStyle}>
          <div style={labelStyle}>Port</div>
          <input
            style={inputStyle}
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1024}
            max={65535}
          />

          <div>
            {gatewayStatus === "stopped" || gatewayStatus === "error" ? (
              <button style={btnStyle("primary")} onClick={startGateway} disabled={busy}>
                {busy ? "Starting..." : "Start Gateway"}
              </button>
            ) : (
              <button style={btnStyle("danger")} onClick={stopGateway} disabled={busy}>
                {busy ? "Stopping..." : "Stop Gateway"}
              </button>
            )}
          </div>

          <div style={infoStyle}>
            Status: {gatewayStatus} {mode === "embedded" ? "(active mode)" : ""}
          </div>
          {gatewayError && (
            <div style={{ ...infoStyle, color: "#b91c1c", marginTop: 6 }}>
              Reason: {gatewayError}
            </div>
          )}
        </div>
      )}

      {tab === "remote" && (
        <div style={cardStyle}>
          <div style={labelStyle}>Gateway WebSocket URL</div>
          <input
            style={inputStyle}
            type="text"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="ws://host:port/ws"
          />

          <div style={labelStyle}>Token</div>
          <input
            style={inputStyle}
            type="password"
            value={remoteToken}
            onChange={(e) => setRemoteToken(e.target.value)}
            placeholder="Bearer token"
          />
          {hasSavedRemoteToken && remoteToken.trim() === "" && (
            <div style={infoStyle}>
              A token is already saved. Leave blank to reuse it, or enter a new token to replace it.
            </div>
          )}

          <div>
            {nodeStatus === "disconnected" || nodeStatus === "error" ? (
              <button style={btnStyle("primary")} onClick={connectNode} disabled={busy}>
                {busy ? "Connecting..." : "Connect"}
              </button>
            ) : (
              <button style={btnStyle("danger")} onClick={disconnectNode} disabled={busy}>
                {busy ? "Disconnecting..." : "Disconnect"}
              </button>
            )}
          </div>

          <div style={infoStyle}>Node status: {nodeStatus}</div>
        </div>
      )}
    </div>
  );
}
