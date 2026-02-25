import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import { colors, heading, card, label as labelStyle, input, btn, info, tabRow, tab as tabStyle } from "../theme.js";

type Tab = "embedded" | "remote";

export function Connection() {
  const [tab, setTab] = useState<Tab>("embedded");
  const [mode, setMode] = useState<string>("embedded");
  const [port, setPort] = useState(8788);
  const [gatewayStatus, setGatewayStatus] = useState("stopped");
  const [remoteUrl, setRemoteUrl] = useState("ws://127.0.0.1:8788/ws");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteTlsCertFingerprint256, setRemoteTlsCertFingerprint256] = useState("");
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
      if (typeof remote?.["tlsCertFingerprint256"] === "string") {
        setRemoteTlsCertFingerprint256(remote["tlsCertFingerprint256"] as string);
      }
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
      const trimmedFingerprint = remoteTlsCertFingerprint256.trim();
      const remoteConfig: Record<string, unknown> = { wsUrl: remoteUrl };
      if (trimmedToken.length > 0) {
        remoteConfig["tokenRef"] = trimmedToken;
        setHasSavedRemoteToken(true);
      }
      remoteConfig["tlsCertFingerprint256"] = trimmedFingerprint;

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
      <h1 style={heading}>Connection</h1>

      <div style={tabRow}>
        <button style={tabStyle(tab === "embedded")} onClick={() => setTab("embedded")}>
          Embedded
        </button>
        <button style={tabStyle(tab === "remote")} onClick={() => setTab("remote")}>
          Remote
        </button>
      </div>

      {tab === "embedded" && (
        <div style={card}>
          <div style={{ ...labelStyle, marginTop: 12 }}>Port</div>
          <input
            style={input}
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1024}
            max={65535}
          />

          <div>
            {gatewayStatus === "stopped" || gatewayStatus === "error" ? (
              <button style={{ ...btn("primary"), marginRight: 8, marginTop: 12 }} onClick={startGateway} disabled={busy}>
                {busy ? "Starting..." : "Start Gateway"}
              </button>
            ) : (
              <button style={{ ...btn("danger"), marginRight: 8, marginTop: 12 }} onClick={stopGateway} disabled={busy}>
                {busy ? "Stopping..." : "Stop Gateway"}
              </button>
            )}
          </div>

          <div style={info}>
            Status: {gatewayStatus} {mode === "embedded" ? "(active mode)" : ""}
          </div>
          {gatewayError && (
            <div style={{ ...info, color: colors.error, marginTop: 6 }}>
              Reason: {gatewayError}
            </div>
          )}
        </div>
      )}

      {tab === "remote" && (
        <div style={card}>
          <div style={{ ...labelStyle, marginTop: 12 }}>Gateway WebSocket URL</div>
          <input
            style={input}
            type="text"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="ws://host:port/ws"
          />

          <div style={{ ...labelStyle, marginTop: 12 }}>Token</div>
          <input
            style={input}
            type="password"
            value={remoteToken}
            onChange={(e) => setRemoteToken(e.target.value)}
            placeholder="Bearer token"
          />
          {hasSavedRemoteToken && remoteToken.trim() === "" && (
            <div style={info}>
              A token is already saved. Leave blank to reuse it, or enter a new token to replace it.
            </div>
          )}

          <div style={{ ...labelStyle, marginTop: 12 }}>TLS certificate fingerprint (SHA-256, optional)</div>
          <input
            style={input}
            type="text"
            value={remoteTlsCertFingerprint256}
            onChange={(e) => setRemoteTlsCertFingerprint256(e.target.value)}
            placeholder="AA:BB:CC:…"
          />

          <div>
            {nodeStatus === "disconnected" || nodeStatus === "error" ? (
              <button style={{ ...btn("primary"), marginRight: 8, marginTop: 12 }} onClick={connectNode} disabled={busy}>
                {busy ? "Connecting..." : "Connect"}
              </button>
            ) : (
              <button style={{ ...btn("danger"), marginRight: 8, marginTop: 12 }} onClick={disconnectNode} disabled={busy}>
                {busy ? "Disconnecting..." : "Disconnect"}
              </button>
            )}
          </div>

          <div style={info}>Node status: {nodeStatus}</div>
        </div>
      )}
    </div>
  );
}
