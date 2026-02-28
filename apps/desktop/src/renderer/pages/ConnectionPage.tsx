import { useEffect, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConnectPage as OperatorConnectPage,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";

type Tab = "embedded" | "remote" | "operator";

export type ConnectionPageProps = DesktopOperatorCoreState;

export function ConnectionPage({ core }: ConnectionPageProps) {
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
      await api.setConfig({ mode: "embedded", embedded: { port } });
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
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Connection</h1>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="embedded">Embedded</TabsTrigger>
          <TabsTrigger value="remote">Remote</TabsTrigger>
          <TabsTrigger value="operator">Operator</TabsTrigger>
        </TabsList>

        <TabsContent value="embedded">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Input
                label="Port"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1024}
                max={65535}
              />

              <div className="flex gap-2">
                {gatewayStatus === "stopped" || gatewayStatus === "error" ? (
                  <Button onClick={startGateway} disabled={busy} isLoading={busy}>
                    {busy ? "Starting..." : "Start Gateway"}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={stopGateway} disabled={busy} isLoading={busy}>
                    {busy ? "Stopping..." : "Stop Gateway"}
                  </Button>
                )}
              </div>

              <div className="text-sm text-fg-muted">
                Status: {gatewayStatus} {mode === "embedded" ? "(active mode)" : ""}
              </div>

              {gatewayError ? (
                <Alert variant="error" title="Gateway error" description={gatewayError} />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="remote">
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <Input
                label="Gateway WebSocket URL"
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="ws://host:port/ws"
              />

              <Input
                label="Token"
                type="password"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder="Bearer token"
                helperText={
                  hasSavedRemoteToken && remoteToken.trim() === ""
                    ? "A token is already saved. Leave blank to reuse it, or enter a new token to replace it."
                    : undefined
                }
              />

              <Input
                label="TLS certificate fingerprint (SHA-256, optional)"
                type="text"
                value={remoteTlsCertFingerprint256}
                onChange={(e) => setRemoteTlsCertFingerprint256(e.target.value)}
                placeholder="AA:BB:CC:…"
              />

              <div className="flex gap-2">
                {nodeStatus === "disconnected" || nodeStatus === "error" ? (
                  <Button onClick={connectNode} disabled={busy} isLoading={busy}>
                    {busy ? "Connecting..." : "Connect"}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={disconnectNode}
                    disabled={busy}
                    isLoading={busy}
                  >
                    {busy ? "Disconnecting..." : "Disconnect"}
                  </Button>
                )}
              </div>

              <div className="text-sm text-fg-muted">Node status: {nodeStatus}</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operator">
          {core ? (
            <OperatorConnectPage core={core} mode="desktop" hideHeader />
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-fg-muted">
                Operator connection not available. Start the gateway to connect.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
